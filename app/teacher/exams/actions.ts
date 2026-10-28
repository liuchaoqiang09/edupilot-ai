"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createExamDraft, saveExamResults } from "@/lib/exam-flow";
import { prisma } from "@/lib/prisma";

function refresh(examId?: string) {
  revalidatePath("/teacher/exams");
  revalidatePath("/parent/exams");
  revalidatePath("/parent/notices");
  if (examId) {
    revalidatePath(`/teacher/exams/${examId}`);
    revalidatePath(`/parent/exams/${examId}`);
  }
}

async function teacherActor() {
  const user = await requireRole("TEACHER", "teacher");
  const teacher = await prisma.teacher.findFirst({
    where: { userId: user.id, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  return { user, teacher };
}

export async function createExam(formData: FormData): Promise<{ ok: boolean; message: string; examId?: string }> {
  const { user, teacher } = await teacherActor();
  if (!teacher) return { ok: false, message: "当前账号还没有关联在职教师档案。" };
  const result = await createExamDraft({
    organizationId: user.organizationId,
    teacherId: teacher.id,
    actorId: user.id,
    actorName: user.name,
    classGroupId: String(formData.get("classGroupId") ?? ""),
    title: String(formData.get("title") ?? ""),
    examDateKey: String(formData.get("examDate") ?? ""),
    scoreMode: String(formData.get("scoreMode") ?? "POINTS"),
    maxScoreRaw: String(formData.get("maxScore") ?? ""),
    showAverage: String(formData.get("showAverage") ?? "") === "1",
  });
  if (!result.ok) return result;
  refresh(result.examId);
  return { ok: true, message: result.message, examId: result.examId };
}

export async function saveExam(examId: string, formData: FormData, publish: boolean): Promise<{ ok: boolean; message: string }> {
  const { user, teacher } = await teacherActor();
  if (!teacher) return { ok: false, message: "当前账号还没有关联在职教师档案。" };

  const studentIds = formData.getAll("studentId").map(String);
  const rows = studentIds.map((studentId) => ({
    studentId,
    absent: String(formData.get(`absent:${studentId}`) ?? "") === "1",
    scoreRaw: String(formData.get(`score:${studentId}`) ?? ""),
    gradeRaw: String(formData.get(`grade:${studentId}`) ?? ""),
    commentRaw: String(formData.get(`comment:${studentId}`) ?? ""),
  }));

  const result = await saveExamResults({
    organizationId: user.organizationId,
    teacherId: teacher.id,
    actorId: user.id,
    actorName: user.name,
    examId,
    classSummary: String(formData.get("classSummary") ?? ""),
    showAverage: String(formData.get("showAverage") ?? "") === "1",
    rows,
    publish,
  });
  if (!result.ok) return result;
  refresh(examId);
  return result;
}
