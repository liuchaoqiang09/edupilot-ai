"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type ActionResult = { ok: boolean; message?: string };

const limit = 2000;

function clean(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function tooLong(value: string) {
  return value.length > limit;
}

function refresh() {
  revalidatePath("/teacher/records");
  revalidatePath("/teacher/reports");
  revalidatePath("/owner/reports");
  revalidatePath("/parent/reports");
}

async function ownLesson(lessonId: string) {
  const user = await requireRole("TEACHER", "teacher");
  const teacher = await prisma.teacher.findFirst({
    where: { userId: user.id, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!teacher) return { user, teacher: null, lesson: null };
  const lesson = await prisma.lessonSession.findFirst({
    where: { id: lessonId, organizationId: user.organizationId, teacherId: teacher.id, status: { not: "CANCELLED" } },
    include: {
      students: { select: { studentId: true, student: { select: { name: true } } } },
      teachingRecord: { select: { id: true, lessonContent: true, studentPerformance: true, difficulties: true, homework: true } },
    },
  });
  return { user, teacher, lesson };
}

export async function saveTeachingRecord(lessonId: string, formData: FormData): Promise<ActionResult> {
  const { user, teacher, lesson } = await ownLesson(lessonId);
  if (!teacher) return { ok: false, message: "当前账号还没有关联在职教师档案。" };
  if (!lesson) return { ok: false, message: "这节课不存在，或你无权填写记录。" };

  const lessonContent = clean(formData.get("lessonContent"));
  const studentPerformance = clean(formData.get("studentPerformance"));
  const difficulties = clean(formData.get("difficulties"));
  const homework = clean(formData.get("homework"));
  const teacherPrivateNote = clean(formData.get("teacherPrivateNote"));
  if ([lessonContent, studentPerformance, difficulties, homework, teacherPrivateNote].some(tooLong)) {
    return { ok: false, message: "每一项不能超过 2000 个字。" };
  }

  await prisma.teachingRecord.upsert({
    where: { lessonSessionId: lesson.id },
    create: {
      organizationId: user.organizationId,
      lessonSessionId: lesson.id,
      teacherId: teacher.id,
      lessonContent,
      studentPerformance,
      difficulties,
      homework: homework || null,
      teacherPrivateNote: teacherPrivateNote || null,
    },
    update: {
      lessonContent,
      studentPerformance,
      difficulties,
      homework: homework || null,
      teacherPrivateNote: teacherPrivateNote || null,
    },
  });
  refresh();
  return { ok: true };
}

export async function updateReport(reportId: string, formData: FormData): Promise<ActionResult> {
  const user = await requireRole("TEACHER", "teacher");
  const teacher = await prisma.teacher.findFirst({
    where: { userId: user.id, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!teacher) return { ok: false, message: "当前账号还没有关联在职教师档案。" };

  const summary = clean(formData.get("summary"));
  const strengths = clean(formData.get("strengths"));
  const issues = clean(formData.get("issues"));
  const nextSteps = clean(formData.get("nextSteps"));
  const homeworkSummary = clean(formData.get("homeworkSummary"));
  if ([summary, strengths, issues, nextSteps, homeworkSummary].some(tooLong)) {
    return { ok: false, message: "每一项不能超过 2000 个字。" };
  }

  const updated = await prisma.teachingReport.updateMany({
    where: {
      id: reportId,
      organizationId: user.organizationId,
      status: { in: ["DRAFT", "RETURNED"] },
      lessonSession: { teacherId: teacher.id },
    },
    data: { summary, strengths, issues, nextSteps, homeworkSummary: homeworkSummary || null },
  });
  if (updated.count !== 1) return { ok: false, message: "这份报告不能修改，或你无权编辑。" };
  refresh();
  return { ok: true };
}

export async function publishReport(reportId: string): Promise<ActionResult> {
  const user = await requireRole("TEACHER", "teacher");
  const teacher = await prisma.teacher.findFirst({
    where: { userId: user.id, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!teacher) return { ok: false, message: "当前账号还没有关联在职教师档案。" };

  const report = await prisma.teachingReport.findFirst({
    where: {
      id: reportId,
      organizationId: user.organizationId,
      status: { in: ["DRAFT", "CONFIRMED", "RETURNED"] },
      lessonSession: { teacherId: teacher.id },
    },
    select: { id: true, summary: true, strengths: true, issues: true, nextSteps: true },
  });
  if (!report) return { ok: false, message: "这份报告不能发布，或你无权操作。" };
  if (!report.summary || !report.strengths || !report.issues || !report.nextSteps) {
    return { ok: false, message: "概述、表现、问题和建议都需要填写后才能发布。" };
  }

  const now = new Date();
  const updated = await prisma.teachingReport.updateMany({
    where: { id: report.id, organizationId: user.organizationId, status: { in: ["DRAFT", "CONFIRMED", "RETURNED"] } },
    data: {
      status: "PUBLISHED",
      confirmedById: user.id,
      confirmedAt: now,
      publishedById: user.id,
      publishedAt: now,
      revision: { increment: 1 },
    },
  });
  if (updated.count !== 1) return { ok: false, message: "发布没有完成，请刷新后再试。" };
  await writeAudit(prisma, {
    organizationId: user.organizationId,
    actorId: user.id,
    action: "REPORT_PUBLISHED",
    targetType: "TeachingReport",
    targetId: report.id,
    detail: "教师发布报告",
  });
  refresh();
  return { ok: true };
}
