"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createParentInvite, createTeacherInvite } from "@/lib/membership";
import { prisma } from "@/lib/prisma";

export async function issueTeacherInvite(teacherId?: string): Promise<{ ok: boolean; message?: string; code?: string }> {
  const user = await requireRole("OWNER", "owner");
  const result = await createTeacherInvite(prisma, { id: user.id, organizationId: user.organizationId }, { teacherId });
  revalidatePath("/owner/teachers");
  return result;
}

export async function issueParentInvite(studentId: string): Promise<{ ok: boolean; message?: string; code?: string }> {
  const user = await requireRole("OWNER", "owner");
  const result = await createParentInvite(prisma, { id: user.id, organizationId: user.organizationId }, studentId);
  revalidatePath("/owner/students");
  return result;
}
