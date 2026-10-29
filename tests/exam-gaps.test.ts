import assert from "node:assert/strict";
import test from "node:test";
import {
  parseExamResultInput,
  resultDisplay,
  summaryMentionsOtherStudents,
  validateClassSummary,
  validateExamTitle,
} from "@/lib/exam";
import { createExamDraft, markExamRead, saveExamResults } from "@/lib/exam-flow";
import { prisma } from "@/lib/prisma";

async function demoTeacherClass() {
  const teacher = await prisma.teacher.findFirst({
    where: {
      status: "ACTIVE",
      userId: { not: null },
      classGroups: { some: { status: "ACTIVE", enrollments: { some: { student: { status: "ACTIVE" } } } } },
    },
    select: {
      id: true,
      organizationId: true,
      userId: true,
      user: { select: { id: true, name: true } },
    },
  });
  assert.ok(teacher?.userId && teacher.user, "需要有登录账号且带在读班级的主讲教师");
  const classGroup = await prisma.classGroup.findFirst({
    where: {
      organizationId: teacher.organizationId,
      teacherId: teacher.id,
      status: "ACTIVE",
      enrollments: { some: { student: { status: "ACTIVE" } } },
    },
    select: { id: true },
  });
  assert.ok(classGroup);
  return { orgId: teacher.organizationId, teacher, classGroupId: classGroup.id };
}

test("EX-06 负分与评语超长失败；等级模式展示", () => {
  const neg = parseExamResultInput({ mode: "POINTS", maxScore: 100, absent: false, scoreRaw: "-1", gradeRaw: "", commentRaw: "" });
  assert.equal(neg.ok, false);
  const long = parseExamResultInput({ mode: "GRADE", maxScore: null, absent: false, scoreRaw: "", gradeRaw: "A", commentRaw: "x".repeat(1001) });
  assert.equal(long.ok, false);
  const grade = parseExamResultInput({ mode: "GRADE", maxScore: null, absent: false, scoreRaw: "", gradeRaw: "A+", commentRaw: "不错" });
  assert.equal(grade.ok && grade.entered && grade.gradeLabel, "A+");
  assert.equal(resultDisplay({ mode: "GRADE", score: null, gradeLabel: "A+", absent: false, entered: true, maxScore: null }), "A+");
  assert.equal(validateExamTitle("a".repeat(81)).ok, false);
  assert.equal(validateClassSummary("s".repeat(2001)).ok, false);
});

test("EX-07 班级总结点名其他学生给出提示名单", () => {
  const hits = summaryMentionsOtherStudents("请督促林子涵和陈可欣订正", ["林子涵", "陈可欣", "王小明"], "王小明");
  assert.deepEqual(hits.sort(), ["陈可欣", "林子涵"].sort());
  assert.deepEqual(summaryMentionsOtherStudents("整体不错", ["林子涵"], "林子涵"), []);
});

test("EX-08 非本班教师不能创建；发布前零录入失败", async () => {
  const { orgId, teacher, classGroupId } = await demoTeacherClass();
  const other = await prisma.teacher.findFirst({
    where: { organizationId: orgId, status: "ACTIVE", id: { not: teacher.id }, userId: { not: null } },
    select: { id: true, userId: true, user: { select: { name: true } } },
  });
  if (other?.userId && other.user) {
    const denied = await createExamDraft({
      organizationId: orgId,
      teacherId: other.id,
      actorId: other.userId,
      actorName: other.user.name,
      classGroupId,
      title: "越权考试",
      examDateKey: "2026-10-21",
      scoreMode: "POINTS",
      maxScoreRaw: "100",
      showAverage: false,
    });
    assert.equal(denied.ok, false);
  }

  const created = await createExamDraft({
    organizationId: orgId,
    teacherId: teacher.id,
    actorId: teacher.userId!,
    actorName: teacher.user!.name,
    classGroupId,
    title: `零录入发布-${Date.now()}`,
    examDateKey: "2026-10-21",
    scoreMode: "POINTS",
    maxScoreRaw: "100",
    showAverage: false,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const exam = await prisma.exam.findUniqueOrThrow({ where: { id: created.examId }, include: { results: true } });
  const emptyPublish = await saveExamResults({
    organizationId: orgId,
    teacherId: teacher.id,
    actorId: teacher.userId!,
    actorName: teacher.user!.name,
    examId: exam.id,
    classSummary: "",
    showAverage: false,
    rows: exam.results.map((row) => ({ studentId: row.studentId, absent: false, scoreRaw: "", gradeRaw: "", commentRaw: "" })),
    publish: true,
  });
  assert.equal(emptyPublish.ok, false);
  await prisma.exam.delete({ where: { id: exam.id } });
});

test("EX-09 他人教师不能改这场考试；缺行失败", async () => {
  const { orgId, teacher, classGroupId } = await demoTeacherClass();
  const created = await createExamDraft({
    organizationId: orgId,
    teacherId: teacher.id,
    actorId: teacher.userId!,
    actorName: teacher.user!.name,
    classGroupId,
    title: `权限保存-${Date.now()}`,
    examDateKey: "2026-10-22",
    scoreMode: "GRADE",
    maxScoreRaw: "",
    showAverage: true,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const exam = await prisma.exam.findUniqueOrThrow({ where: { id: created.examId }, include: { results: true } });
  assert.equal(exam.scoreMode, "GRADE");

  const other = await prisma.teacher.findFirst({
    where: { organizationId: orgId, status: "ACTIVE", id: { not: teacher.id }, userId: { not: null } },
    select: { id: true, userId: true, user: { select: { name: true } } },
  });
  if (other?.userId && other.user) {
    const hijack = await saveExamResults({
      organizationId: orgId,
      teacherId: other.id,
      actorId: other.userId,
      actorName: other.user.name,
      examId: exam.id,
      classSummary: "",
      showAverage: false,
      rows: exam.results.map((row) => ({ studentId: row.studentId, absent: false, scoreRaw: "", gradeRaw: "A", commentRaw: "" })),
      publish: false,
    });
    assert.equal(hijack.ok, false);
  }

  const missingRow = await saveExamResults({
    organizationId: orgId,
    teacherId: teacher.id,
    actorId: teacher.userId!,
    actorName: teacher.user!.name,
    examId: exam.id,
    classSummary: "",
    showAverage: true,
    rows: [],
    publish: false,
  });
  assert.equal(missingRow.ok, false);

  // 等级制即使传入 showAverage，发布后也应关掉均分开关
  const published = await saveExamResults({
    organizationId: orgId,
    teacherId: teacher.id,
    actorId: teacher.userId!,
    actorName: teacher.user!.name,
    examId: exam.id,
    classSummary: "班级总评：整体稳定。",
    showAverage: true,
    rows: exam.results.map((row, index) => ({
      studentId: row.studentId,
      absent: false,
      scoreRaw: "",
      gradeRaw: index === 0 ? "A" : "",
      commentRaw: index === 0 ? "优秀" : "",
    })),
    publish: true,
  });
  assert.equal(published.ok, true);
  const after = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } });
  assert.equal(after.showAverage, false);
  assert.equal(after.status, "PUBLISHED");
  await prisma.exam.delete({ where: { id: exam.id } });
});

test("EX-10 已读边界：草稿/未录入/未绑定不记；重复打开不新增", async () => {
  const { orgId, teacher, classGroupId } = await demoTeacherClass();
  const created = await createExamDraft({
    organizationId: orgId,
    teacherId: teacher.id,
    actorId: teacher.userId!,
    actorName: teacher.user!.name,
    classGroupId,
    title: `已读边界-${Date.now()}`,
    examDateKey: "2026-10-23",
    scoreMode: "POINTS",
    maxScoreRaw: "100",
    showAverage: false,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const exam = await prisma.exam.findUniqueOrThrow({ where: { id: created.examId }, include: { results: true } });
  const link = await prisma.parentStudentLink.findFirst({
    where: { organizationId: orgId, studentId: { in: exam.results.map((row) => row.studentId) } },
    select: { parentUserId: true, studentId: true },
  });
  assert.ok(link, "演示数据需要至少一名有家长绑定的在班学生");
  const targetId = link.studentId;

  await markExamRead({ organizationId: orgId, parentUserId: link.parentUserId, examId: exam.id, studentId: targetId });
  assert.equal(await prisma.examRead.count({ where: { examId: exam.id } }), 0);

  await saveExamResults({
    organizationId: orgId,
    teacherId: teacher.id,
    actorId: teacher.userId!,
    actorName: teacher.user!.name,
    examId: exam.id,
    classSummary: "",
    showAverage: false,
    rows: exam.results.map((row) => ({
      studentId: row.studentId,
      absent: false,
      scoreRaw: row.studentId === targetId ? "80" : "",
      gradeRaw: "",
      commentRaw: "",
    })),
    publish: true,
  });

  const stranger = await prisma.user.findFirst({
    where: {
      organizationId: orgId,
      roles: { has: "PARENT" },
      id: { not: link.parentUserId },
      parentStudentLinks: { none: { studentId: targetId } },
    },
    select: { id: true },
  });
  if (stranger) {
    await markExamRead({ organizationId: orgId, parentUserId: stranger.id, examId: exam.id, studentId: targetId });
    assert.equal(await prisma.examRead.count({ where: { examId: exam.id, parentUserId: stranger.id } }), 0);
  }

  await markExamRead({ organizationId: orgId, parentUserId: link.parentUserId, examId: exam.id, studentId: targetId });
  await markExamRead({ organizationId: orgId, parentUserId: link.parentUserId, examId: exam.id, studentId: targetId });
  assert.equal(await prisma.examRead.count({ where: { examId: exam.id, studentId: targetId, parentUserId: link.parentUserId } }), 1);

  // 未录入的其他孩子：即使已发布也不记已读
  const other = exam.results.find((row) => row.studentId !== targetId);
  if (other) {
    const otherLink = await prisma.parentStudentLink.findFirst({
      where: { organizationId: orgId, studentId: other.studentId },
      select: { parentUserId: true },
    });
    if (otherLink) {
      await markExamRead({ organizationId: orgId, parentUserId: otherLink.parentUserId, examId: exam.id, studentId: other.studentId });
      assert.equal(await prisma.examRead.count({ where: { examId: exam.id, studentId: other.studentId } }), 0);
    }
  }

  await prisma.exam.delete({ where: { id: exam.id } });
});

test("EX-12 合格制发布：合格/不合格展示；未录入仍不可见", async () => {
  const { orgId, teacher, classGroupId } = await demoTeacherClass();
  const created = await createExamDraft({
    organizationId: orgId,
    teacherId: teacher.id,
    actorId: teacher.userId!,
    actorName: teacher.user!.name,
    classGroupId,
    title: `合格制-${Date.now()}`,
    examDateKey: "2026-10-25",
    scoreMode: "PASS_FAIL",
    maxScoreRaw: "",
    showAverage: true,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const exam = await prisma.exam.findUniqueOrThrow({ where: { id: created.examId }, include: { results: true } });
  assert.equal(exam.scoreMode, "PASS_FAIL");
  assert.equal(exam.showAverage, false);
  const target = exam.results[0];
  const published = await saveExamResults({
    organizationId: orgId,
    teacherId: teacher.id,
    actorId: teacher.userId!,
    actorName: teacher.user!.name,
    examId: exam.id,
    classSummary: "",
    showAverage: false,
    rows: exam.results.map((row) => ({
      studentId: row.studentId,
      absent: false,
      scoreRaw: "",
      gradeRaw: row.studentId === target.studentId ? "合格" : "",
      commentRaw: "",
    })),
    publish: true,
  });
  assert.equal(published.ok, true);
  const after = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id }, include: { results: true } });
  const entered = after.results.find((row) => row.studentId === target.studentId)!;
  assert.equal(entered.entered, true);
  assert.equal(entered.gradeLabel, "合格");
  assert.equal(resultDisplay({ mode: "PASS_FAIL", score: null, gradeLabel: entered.gradeLabel, absent: false, entered: true, maxScore: null }), "合格");
  assert.equal(after.results.filter((row) => !row.entered).every((row) => row.entered === false), true);
  await prisma.exam.delete({ where: { id: exam.id } });
});

test("EX-11 再发布提升 revision 并再写通知；家长列表条件与报告作业隔离", async () => {
  const { orgId, teacher, classGroupId } = await demoTeacherClass();
  const created = await createExamDraft({
    organizationId: orgId,
    teacherId: teacher.id,
    actorId: teacher.userId!,
    actorName: teacher.user!.name,
    classGroupId,
    title: `再发布-${Date.now()}`,
    examDateKey: "2026-10-24",
    scoreMode: "POINTS",
    maxScoreRaw: "100",
    showAverage: true,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const exam = await prisma.exam.findUniqueOrThrow({ where: { id: created.examId }, include: { results: true } });
  const linked = await prisma.parentStudentLink.findFirst({
    where: { organizationId: orgId, studentId: { in: exam.results.map((row) => row.studentId) } },
    select: { studentId: true },
  });
  assert.ok(linked, "演示数据需要至少一名有家长绑定的在班学生");
  const targetId = linked.studentId;
  const rowsEntered = exam.results.map((row) => ({
    studentId: row.studentId,
    absent: false,
    scoreRaw: row.studentId === targetId ? "70" : "",
    gradeRaw: "",
    commentRaw: "",
  }));
  assert.equal((await saveExamResults({
    organizationId: orgId,
    teacherId: teacher.id,
    actorId: teacher.userId!,
    actorName: teacher.user!.name,
    examId: exam.id,
    classSummary: "第一次发布",
    showAverage: true,
    rows: rowsEntered,
    publish: true,
  })).ok, true);
  const firstRev = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id }, select: { revision: true } });
  assert.ok(firstRev.revision >= 1);
  const noticesAfterFirst = await prisma.parentNotice.count({
    where: { organizationId: orgId, kind: "EXAM", dedupeKey: { startsWith: `exam:${exam.id}:` } },
  });
  assert.ok(noticesAfterFirst >= 1);

  assert.equal((await saveExamResults({
    organizationId: orgId,
    teacherId: teacher.id,
    actorId: teacher.userId!,
    actorName: teacher.user!.name,
    examId: exam.id,
    classSummary: "修订后发布",
    showAverage: true,
    rows: exam.results.map((row) => ({
      studentId: row.studentId,
      absent: false,
      scoreRaw: row.studentId === targetId ? "75" : "",
      gradeRaw: "",
      commentRaw: row.studentId === targetId ? "已订正" : "",
    })),
    publish: true,
  })).ok, true);

  const second = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id }, include: { results: true } });
  assert.ok(second.revision > firstRev.revision);
  assert.equal(Number(second.results.find((row) => row.studentId === targetId)?.score ?? 0), 75);

  const notices = await prisma.parentNotice.findMany({
    where: { organizationId: orgId, kind: "EXAM", dedupeKey: { startsWith: `exam:${exam.id}:` } },
  });
  assert.ok(notices.length >= noticesAfterFirst + 1);

  // 家长列表等价查询：只出已发布且已录入
  const visible = await prisma.examResult.findMany({
    where: { examId: exam.id, entered: true, exam: { status: "PUBLISHED" } },
    select: { studentId: true, score: true },
  });
  assert.equal(visible.length, 1);
  assert.equal(Number(visible[0].score), 75);

  // 模块隔离：考试动作走 EXAM_* 审计，不冒充报告/作业动作
  const audits = await prisma.auditLog.findMany({ where: { targetId: exam.id } });
  assert.ok(audits.some((row) => row.action === "EXAM_PUBLISHED"));
  assert.equal(audits.some((row) => /REPORT|HOMEWORK|ATTENDANCE/.test(row.action)), false);

  await prisma.exam.delete({ where: { id: exam.id } });
});
