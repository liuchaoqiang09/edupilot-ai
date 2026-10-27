"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function replyToReport(reportId: string, body: string) {
  const user = await requireRole("PARENT", "parent");
  const text = body.trim();
  if (text.length > 300) return { ok: false as const, message: "回复不能超过 300 个字。" };
  const report = await prisma.teachingReport.findFirst({
    where: { id: reportId, organizationId: user.organizationId, status: "PUBLISHED" },
    select: { id: true, studentId: true },
  });
  const link = report
    ? await prisma.parentStudentLink.findFirst({ where: { organizationId: user.organizationId, parentUserId: user.id, studentId: report.studentId }, select: { id: true } })
    : null;
  if (!report || !link) return { ok: false as const, message: "只能回复已绑定孩子的已发布报告。" };
  if (!text) {
    await prisma.reportReply.deleteMany({ where: { reportId: report.id, parentUserId: user.id, organizationId: user.organizationId } });
    revalidatePath("/parent/reports");
    revalidatePath("/teacher/records");
    revalidatePath("/owner/reports");
    return { ok: true as const, message: "回复已清空。" };
  }
  await prisma.reportReply.upsert({
    where: { reportId_parentUserId: { reportId: report.id, parentUserId: user.id } },
    create: { organizationId: user.organizationId, reportId: report.id, parentUserId: user.id, body: text },
    update: { body: text },
  });
  revalidatePath("/parent/reports");
  revalidatePath("/teacher/records");
  revalidatePath("/owner/reports");
  return { ok: true as const, message: "回复已保存。老师和负责人能在这份报告里看到。" };
}
