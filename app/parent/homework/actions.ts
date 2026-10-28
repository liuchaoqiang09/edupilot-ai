"use server";

import { requireRole } from "@/lib/auth";
import { canParentEditSubmission } from "@/lib/homework";
import { removeHomeworkAssetFile } from "@/lib/homework-files";
import { findParentHomeworkSeat, submitHomeworkForParent } from "@/lib/homework-flow";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function submitHomework(lessonStudentId: string, formData: FormData): Promise<{ ok: boolean; message: string }> {
  const user = await requireRole("PARENT", "parent");
  const files = [
    ...formData.getAll("photos"),
    ...formData.getAll("camera"),
    ...formData.getAll("files"),
  ].filter((item): item is File => item instanceof File && item.size > 0);
  return submitHomeworkForParent({
    organizationId: user.organizationId,
    parentUserId: user.id,
    lessonStudentId,
    bodyRaw: String(formData.get("body") ?? ""),
    removeAssetIds: formData.getAll("removeAsset").map(String).filter(Boolean),
    files,
  });
}

export async function removeHomeworkAsset(lessonStudentId: string, assetId: string): Promise<{ ok: boolean; message: string }> {
  const user = await requireRole("PARENT", "parent");
  const seat = await findParentHomeworkSeat({
    lessonStudentId,
    parentUserId: user.id,
    organizationId: user.organizationId,
  });
  if (!seat) return { ok: false, message: "找不到这份作业，或你没有权限。" };
  const asset = await prisma.homeworkAsset.findFirst({
    where: {
      id: assetId,
      organizationId: user.organizationId,
      submission: { lessonSessionId: seat.lessonSessionId, studentId: seat.studentId },
    },
    select: { id: true, contentType: true, submission: { select: { status: true } } },
  });
  if (!asset) return { ok: false, message: "没有找到这个附件。" };
  if (!canParentEditSubmission(asset.submission.status)) return { ok: false, message: "已批改或已完成，不能再删附件。" };
  await prisma.homeworkAsset.delete({ where: { id: asset.id } });
  await removeHomeworkAssetFile(asset.id, asset.contentType);
  revalidatePath("/parent/homework");
  revalidatePath("/teacher/homework");
  revalidatePath(`/parent/homework/${lessonStudentId}`);
  return { ok: true, message: "已去掉。" };
}
