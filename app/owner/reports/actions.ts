"use server";

import { revalidatePath } from "next/cache";
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

  revalidatePath("/owner/reports");
  revalidatePath("/teacher/records");
  revalidatePath("/teacher/reports");
  revalidatePath("/parent/reports");
  return { ok: true };
}
