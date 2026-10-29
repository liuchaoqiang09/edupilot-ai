"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { applyCancelParentLeave, applyParentLeave } from "@/lib/parent-leave";

export type LeaveResult = { ok: boolean; message: string };

function refreshLeave() {
  revalidatePath("/parent/schedule");
  revalidatePath("/parent/attendance");
  revalidatePath("/teacher");
  revalidatePath("/teacher/schedule");
  revalidatePath("/owner/attendance");
  revalidatePath("/owner/audit");
}

export async function requestParentLeave(formData: FormData): Promise<LeaveResult> {
  const user = await requireRole("PARENT", "parent");
  const result = await applyParentLeave(
    { id: user.id, name: user.name, organizationId: user.organizationId },
    {
      lessonStudentId: String(formData.get("lessonStudentId") ?? ""),
      note: String(formData.get("note") ?? ""),
    },
  );
  if (result.ok) refreshLeave();
  return result;
}

export async function cancelParentLeave(formData: FormData): Promise<LeaveResult> {
  const user = await requireRole("PARENT", "parent");
  const result = await applyCancelParentLeave(
    { id: user.id, name: user.name, organizationId: user.organizationId },
    { lessonStudentId: String(formData.get("lessonStudentId") ?? "") },
  );
  if (result.ok) refreshLeave();
  return result;
}
