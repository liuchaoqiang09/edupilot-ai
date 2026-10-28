"use server";

import { requireRole } from "@/lib/auth";
import { reviewHomeworkForTeacher } from "@/lib/homework-flow";
import { prisma } from "@/lib/prisma";

async function ownTeacher(userId: string, organizationId: string) {
  return prisma.teacher.findFirst({
    where: { userId, organizationId, status: "ACTIVE" },
    select: { id: true },
  });
}

export async function gradeHomework(
  submissionId: string,
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const user = await requireRole("TEACHER", "teacher");
  const teacher = await ownTeacher(user.id, user.organizationId);
  if (!teacher) return { ok: false, message: "当前账号还没有关联在职教师档案。" };

  const actionRaw = String(formData.get("action") ?? "grade");
  if (actionRaw !== "grade" && actionRaw !== "complete" && actionRaw !== "return") {
    return { ok: false, message: "未知操作。" };
  }

  return reviewHomeworkForTeacher({
    organizationId: user.organizationId,
    teacherId: teacher.id,
    submissionId,
    action: actionRaw,
    feedbackRaw: String(formData.get("feedback") ?? ""),
    scoreRaw: String(formData.get("score") ?? ""),
  });
}
