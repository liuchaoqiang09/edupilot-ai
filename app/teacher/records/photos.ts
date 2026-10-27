"use server";

import { randomBytes } from "crypto";
import { mkdir, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const types = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

function folder() {
  return join(process.cwd(), "uploads", "report-photos");
}

async function ownDraft(reportId: string, userId: string, organizationId: string) {
  const teacher = await prisma.teacher.findFirst({
    where: { userId, organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!teacher) return null;
  return prisma.teachingReport.findFirst({
    where: { id: reportId, organizationId, status: { not: "PUBLISHED" }, lessonSession: { teacherId: teacher.id } },
    select: { id: true, photos: { select: { id: true } } },
  });
}

export async function addReportPhoto(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const user = await requireRole("TEACHER", "teacher");
  const reportId = String(formData.get("reportId") ?? "");
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "请选择一张课堂照片。" };
  const ext = types.get(file.type);
  if (!ext) return { ok: false, message: "只接受 JPG、PNG 或 WEBP 照片。" };
  if (file.size > 1_500_000) return { ok: false, message: "单张照片不能超过 1.5 MB。" };
  const report = await ownDraft(reportId, user.id, user.organizationId);
  if (!report) return { ok: false, message: "只能给自己还没发布的报告添加照片。" };
  if (report.photos.length >= 3) return { ok: false, message: "一份报告最多 3 张课堂照片。" };
  const id = randomBytes(16).toString("hex");
  await mkdir(folder(), { recursive: true });
  await writeFile(join(folder(), `${id}.${ext}`), Buffer.from(await file.arrayBuffer()));
  await prisma.reportPhoto.create({ data: { id, organizationId: user.organizationId, reportId, contentType: file.type } });
  revalidatePath("/teacher/records");
  revalidatePath("/parent/reports");
  return { ok: true, message: "照片已加上。发布后家长才能看到。" };
}

export async function removeReportPhoto(photoId: string): Promise<{ ok: boolean; message: string }> {
  const user = await requireRole("TEACHER", "teacher");
  const photo = await prisma.reportPhoto.findFirst({
    where: { id: photoId, organizationId: user.organizationId },
    select: { id: true, contentType: true, reportId: true },
  });
  if (!photo) return { ok: false, message: "没有找到这张照片。" };
  const report = await ownDraft(photo.reportId, user.id, user.organizationId);
  if (!report) return { ok: false, message: "已发布的报告不能再改照片。" };
  const ext = types.get(photo.contentType) ?? "jpg";
  await prisma.reportPhoto.delete({ where: { id: photo.id } });
  await unlink(join(folder(), `${photo.id}.${ext}`)).catch(() => undefined);
  revalidatePath("/teacher/records");
  revalidatePath("/parent/reports");
  return { ok: true, message: "照片已去掉。" };
}
