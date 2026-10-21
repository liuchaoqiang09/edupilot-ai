"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { publishReportByOwner, returnReportByOwner } from "@/lib/report-flow";

export type ActionResult = { ok: boolean; message?: string };

function refresh() {
  revalidatePath("/owner/reports");
  revalidatePath("/teacher/records");
  revalidatePath("/teacher/reports");
  revalidatePath("/parent/reports");
}

export async function returnReport(reportId: string, formData: FormData): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  const reason = typeof formData.get("revisionNote") === "string" ? formData.get("revisionNote")!.toString().trim() : "";
  if (!reason) return { ok: false, message: "请填写退回原因。" };
  if (reason.length > 200) return { ok: false, message: "退回原因不能超过 200 个字。" };

  const result = await returnReportByOwner(prisma, { id: user.id, organizationId: user.organizationId }, reportId, reason);
  if (!result.ok) return result;
  refresh();
  return { ok: true };
}

export async function publishReport(reportId: string): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  return publishReportByOwner(prisma, { id: user.id, organizationId: user.organizationId }, reportId);
}
