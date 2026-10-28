import { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { parseExamDateKey, parseExamResultInput, parseScoreMode, validateClassSummary, validateExamTitle } from "@/lib/exam";
import { formatDateLabel, shanghaiDateKey } from "@/lib/datetime";
import { notifyLinkedParents } from "@/lib/parent-notice";
import { prisma } from "@/lib/prisma";

type Tx = Prisma.TransactionClient;

export async function rosterStudentIds(organizationId: string, classGroupId: string) {
  const rows = await prisma.enrollment.findMany({
    where: {
      organizationId,
      classGroupId,
      student: { status: "ACTIVE" },
    },
    select: { studentId: true, student: { select: { name: true } } },
  });
  const map = new Map<string, string>();
  for (const row of rows) map.set(row.studentId, row.student.name);
  return [...map].map(([studentId, name]) => ({ studentId, name })).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

export async function createExamDraft(input: {
  organizationId: string;
  teacherId: string;
  actorId: string;
  actorName: string;
  classGroupId: string;
  title: string;
  examDateKey: string;
  scoreMode: string;
  maxScoreRaw: string;
  showAverage: boolean;
}) {
  const titleCheck = validateExamTitle(input.title);
  if (!titleCheck.ok) return titleCheck;
  const examDate = parseExamDateKey(input.examDateKey);
  if (!examDate) return { ok: false as const, message: "请填写正确的考试日期。" };
  const scoreMode = parseScoreMode(input.scoreMode);
  if (!scoreMode) return { ok: false as const, message: "计分方式无效。" };

  let maxScore: number | null = null;
  if (scoreMode === "POINTS") {
    const raw = input.maxScoreRaw.trim();
    if (!raw) return { ok: false as const, message: "分数制请填写满分。" };
    maxScore = Number(raw);
    if (!Number.isFinite(maxScore) || maxScore <= 0) return { ok: false as const, message: "满分必须大于 0。" };
    if (maxScore > 1000) return { ok: false as const, message: "满分不能超过 1000。" };
  }

  const classGroup = await prisma.classGroup.findFirst({
    where: {
      id: input.classGroupId,
      organizationId: input.organizationId,
      teacherId: input.teacherId,
      status: "ACTIVE",
    },
    select: { id: true, name: true, courseId: true, course: { select: { name: true } } },
  });
  if (!classGroup) return { ok: false as const, message: "只能为自己负责的在用班级创建考试。" };

  const roster = await rosterStudentIds(input.organizationId, classGroup.id);
  if (roster.length === 0) return { ok: false as const, message: "这个班还没有在读报名学生，不能创建考试。" };

  const exam = await prisma.$transaction(async (tx) => {
    const created = await tx.exam.create({
      data: {
        organizationId: input.organizationId,
        classGroupId: classGroup.id,
        courseId: classGroup.courseId,
        teacherId: input.teacherId,
        title: titleCheck.title,
        examDate,
        scoreMode,
        maxScore: maxScore == null ? null : new Prisma.Decimal(maxScore),
        showAverage: input.showAverage && scoreMode === "POINTS",
        status: "DRAFT",
      },
    });
    await tx.examResult.createMany({
      data: roster.map((row) => ({
        organizationId: input.organizationId,
        examId: created.id,
        studentId: row.studentId,
      })),
    });
    await writeAudit(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "EXAM_CREATED",
      targetType: "Exam",
      targetId: created.id,
      detail: `${input.actorName}创建考试「${titleCheck.title}」（${classGroup.course.name} · ${classGroup.name}）`,
    });
    return created;
  });

  return { ok: true as const, examId: exam.id, message: "考试草稿已创建，请录入成绩。" };
}

export async function saveExamResults(input: {
  organizationId: string;
  teacherId: string;
  actorId: string;
  actorName: string;
  examId: string;
  classSummary: string;
  showAverage: boolean;
  rows: Array<{ studentId: string; absent: boolean; scoreRaw: string; gradeRaw: string; commentRaw: string }>;
  publish: boolean;
}) {
  const exam = await prisma.exam.findFirst({
    where: {
      id: input.examId,
      organizationId: input.organizationId,
      teacherId: input.teacherId,
    },
    include: {
      results: { select: { id: true, studentId: true, student: { select: { name: true } } } },
      classGroup: { select: { name: true } },
      course: { select: { name: true } },
    },
  });
  if (!exam) return { ok: false as const, message: "找不到这场考试，或你不是录入教师。" };
  if (exam.status === "PUBLISHED" && input.publish) {
    // allow re-save while published as revision publish
  }

  const summaryCheck = validateClassSummary(input.classSummary);
  if (!summaryCheck.ok) return summaryCheck;

  const maxScore = exam.maxScore == null ? null : Number(exam.maxScore);
  const byStudent = new Map(input.rows.map((row) => [row.studentId, row]));
  const updates: Array<{
    studentId: string;
    studentName: string;
    entered: boolean;
    absent: boolean;
    score: number | null;
    gradeLabel: string | null;
    comment: string | null;
  }> = [];

  for (const result of exam.results) {
    const row = byStudent.get(result.studentId);
    if (!row) return { ok: false as const, message: `缺少 ${result.student.name} 的成绩行。` };
    const parsed = parseExamResultInput({
      mode: exam.scoreMode,
      maxScore,
      absent: row.absent,
      scoreRaw: row.scoreRaw,
      gradeRaw: row.gradeRaw,
      commentRaw: row.commentRaw,
    });
    if (!parsed.ok) return { ok: false as const, message: `${result.student.name}：${parsed.message}` };
    updates.push({
      studentId: result.studentId,
      studentName: result.student.name,
      entered: parsed.entered,
      absent: parsed.absent,
      score: parsed.score,
      gradeLabel: parsed.gradeLabel,
      comment: parsed.comment,
    });
  }

  if (input.publish) {
    const enteredCount = updates.filter((row) => row.entered).length;
    if (enteredCount === 0) return { ok: false as const, message: "发布前请至少录入一名学生的成绩或缺考。" };
  }

  const now = new Date();
  await prisma.$transaction(async (tx: Tx) => {
    await tx.exam.update({
      where: { id: exam.id },
      data: {
        classSummary: summaryCheck.classSummary,
        showAverage: exam.scoreMode === "POINTS" ? input.showAverage : false,
        ...(input.publish
          ? {
              status: "PUBLISHED" as const,
              publishedAt: now,
              publishedById: input.actorId,
              revision: { increment: 1 },
            }
          : {}),
      },
    });
    for (const row of updates) {
      await tx.examResult.update({
        where: { examId_studentId: { examId: exam.id, studentId: row.studentId } },
        data: {
          entered: row.entered,
          absent: row.absent,
          score: row.score == null ? null : new Prisma.Decimal(row.score),
          gradeLabel: row.gradeLabel,
          comment: row.comment,
        },
      });
    }
    await writeAudit(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: input.publish ? "EXAM_PUBLISHED" : "EXAM_SAVED",
      targetType: "Exam",
      targetId: exam.id,
      detail: input.publish
        ? `${input.actorName}发布考试「${exam.title}」成绩`
        : `${input.actorName}保存考试「${exam.title}」草稿`,
    });
  });

  if (input.publish) {
    const studentIds = updates.filter((row) => row.entered).map((row) => row.studentId);
    const when = formatDateLabel(shanghaiDateKey(exam.examDate));
    await notifyLinkedParents({
      organizationId: input.organizationId,
      studentIds,
      kind: "EXAM",
      title: "成绩已发布",
      body: `${when}「${exam.title}」的成绩可以查看`,
      href: `/parent/exams/${exam.id}`,
      dedupeKey: `exam:${exam.id}:r${exam.revision + 1}:${now.toISOString()}`,
    });
  }

  return {
    ok: true as const,
    message: input.publish ? "成绩已发布，已通知相关家长。" : "草稿已保存。家长还看不到。",
  };
}

export async function markExamRead(input: {
  organizationId: string;
  parentUserId: string;
  examId: string;
  studentId: string;
}) {
  const linked = await prisma.parentStudentLink.findFirst({
    where: {
      organizationId: input.organizationId,
      parentUserId: input.parentUserId,
      studentId: input.studentId,
    },
    select: { id: true },
  });
  if (!linked) return;
  const exam = await prisma.exam.findFirst({
    where: { id: input.examId, organizationId: input.organizationId, status: "PUBLISHED" },
    select: { id: true },
  });
  if (!exam) return;
  const result = await prisma.examResult.findFirst({
    where: { examId: exam.id, studentId: input.studentId, entered: true },
    select: { id: true },
  });
  if (!result) return;
  await prisma.examRead.upsert({
    where: {
      examId_studentId_parentUserId: {
        examId: exam.id,
        studentId: input.studentId,
        parentUserId: input.parentUserId,
      },
    },
    create: {
      organizationId: input.organizationId,
      examId: exam.id,
      studentId: input.studentId,
      parentUserId: input.parentUserId,
    },
    update: {},
  });
}
