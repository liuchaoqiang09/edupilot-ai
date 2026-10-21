import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { AiReportError, generateLessonAnalysis } from "@/lib/ai-service";
import { prisma } from "@/lib/prisma";
import { generateAndStoreDraft, readOrgReportSettings, recentSummariesForPrompt } from "@/lib/report-flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(message: string, status: number) {
  return Response.json({ ok: false, message }, { status });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.roles.includes("TEACHER")) return fail("只有授课教师可以生成报告。", 403);

  const body = await request.json().catch(() => null);
  const lessonId = body && typeof body === "object" && "lessonId" in body && typeof body.lessonId === "string" ? body.lessonId : "";
  if (!lessonId) return fail("没有找到要生成的课次。", 400);

  const teacher = await prisma.teacher.findFirst({
    where: { userId: user.id, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!teacher) return fail("当前账号还没有关联在职教师档案。", 403);

  const lesson = await prisma.lessonSession.findFirst({
    where: { id: lessonId, organizationId: user.organizationId, teacherId: teacher.id, status: { not: "CANCELLED" } },
    include: {
      students: { select: { studentId: true, student: { select: { name: true } } } },
      teachingRecord: { select: { id: true, lessonContent: true, studentPerformance: true, difficulties: true, homework: true } },
    },
  });
  if (!lesson) return fail("这节课不存在，或你无权生成报告。", 404);
  if (!lesson.teachingRecord) return fail("请先保存教学记录。", 400);
  const teachingRecord = lesson.teachingRecord;
  if (lesson.students.length === 0) return fail("这节课没有学生，无法生成报告。", 400);

  const existing = await prisma.teachingReport.findMany({
    where: { organizationId: user.organizationId, lessonSessionId: lesson.id },
    select: { id: true, studentId: true, status: true },
  });
  const byStudent = new Map(existing.map((report) => [report.studentId, report]));
  const skipped: string[] = [];
  const targets = lesson.students.filter((row) => {
    const current = byStudent.get(row.studentId);
    if (current && (current.status === "PUBLISHED" || current.status === "CONFIRMED")) {
      skipped.push(row.student.name);
      return false;
    }
    return true;
  });
  if (targets.length === 0) {
    return Response.json({ ok: true, message: `${skipped.join("、")}的报告已确认或已发布，没有覆盖。` });
  }

  const organization = await prisma.organization.findUnique({
    where: { id: user.organizationId },
    select: { reportLanguage: true, aiUseRecentSummaries: true, aiTeacherMustConfirm: true },
  });
  const settings = readOrgReportSettings(organization);
  const names = lesson.students.map((row) => row.student.name);
  let created = 0;
  try {
    for (const row of targets) {
      const history = await recentSummariesForPrompt(prisma, {
        enabled: settings.aiUseRecentSummaries,
        organizationId: user.organizationId,
        studentId: row.studentId,
        courseId: lesson.courseId,
        excludeLessonId: lesson.id,
      });
      const current = byStudent.get(row.studentId);
      await generateAndStoreDraft(
        prisma,
        {
          organizationId: user.organizationId,
          lessonSessionId: lesson.id,
          studentId: row.studentId,
          teachingRecordId: teachingRecord.id,
          existingId: current?.id ?? null,
        },
        () =>
          generateLessonAnalysis({
            language: settings.reportLanguage,
            useRecentSummaries: settings.aiUseRecentSummaries,
            history,
            lessonContent: teachingRecord.lessonContent,
            studentPerformance: teachingRecord.studentPerformance,
            difficulties: teachingRecord.difficulties,
            homework: teachingRecord.homework ?? "",
            studentNames: names,
          }),
      );
      created += 1;
    }
  } catch (error) {
    const message = error instanceof AiReportError ? error.message : "生成失败，教学记录已保留。请稍后重试。";
    return fail(created > 0 ? `已生成 ${created} 份草稿。${message}` : message, 502);
  }

  revalidatePath("/teacher/records");
  revalidatePath("/teacher/reports");
  revalidatePath("/owner/reports");
  revalidatePath("/parent/reports");
  return Response.json({
    ok: true,
    message: skipped.length ? `已生成草稿。${skipped.join("、")}的报告已确认或已发布，没有覆盖。` : "已为名单中的学生生成草稿。",
  });
}
