"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type ActionResult = { ok: boolean; message?: string };

export async function returnReport(reportId: string, formData: FormData): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  const reason = typeof formData.get("revisionNote") === "string" ? formData.get("revisionNote")!.toString().trim() : "";
  if (!reason) return { ok: false, message: "请填写退回原因。" };
  if (reason.length > 200) return { ok: false, message: "退回原因不能超过 200 个字。" };

  const updated = await prisma.teachingReport.updateMany({
    where: {
      id: reportId,
      organizationId: user.organizationId,
      status: { in: ["DRAFT", "CONFIRMED", "PUBLISHED"] },
    },
    data: { status: "RETURNED", revisionNote: reason },
  });
  if (updated.count !== 1) return { ok: false, message: "这份报告不存在，或已经退回。" };

  await writeAudit(prisma, {
    organizationId: user.organizationId,
    actorId: user.id,
    action: "REPORT_RETURNED",
    targetType: "TeachingReport",
    targetId: reportId,
    detail: "负责人退回报告",
  });

  revalidatePath("/owner/reports");
  revalidatePath("/teacher/records");
  revalidatePath("/teacher/reports");
  revalidatePath("/parent/reports");
  return { ok: true };
}

export async function publishReport(reportId: string): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  const report = await prisma.teachingReport.findFirst({
    where: {
      id: reportId,
      organizationId: user.organizationId,
      status: { in: ["DRAFT", "CONFIRMED", "RETURNED"] },
    },
    select: { id: true, summary: true, issues: true, nextSteps: true },
  });
  if (!report) return { ok: false, message: "这份报告不能发布，或你无权操作。" };
  if (!report.summary || !report.issues || !report.nextSteps) {
    return { ok: false, message: "学习总结、发现问题和下一步建议都需要有内容后才能发布。" };
  }

  const now = new Date();
  const updated = await prisma.teachingReport.updateMany({
    where: { id: report.id, organizationId: user.organizationId, status: { in: ["DRAFT", "CONFIRMED", "RETURNED"] } },
    data: {
      status: "PUBLISHED",
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
    detail: "负责人发布报告",
  });

  revalidatePath("/owner/reports");
  revalidatePath("/teacher/records");
  revalidatePath("/teacher/reports");
  revalidatePath("/parent/reports");
  return { ok: true };
}
