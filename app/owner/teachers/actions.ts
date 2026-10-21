"use server";

import { revalidatePath } from "next/cache";
import { MemberStatus } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type FieldErrors = Partial<Record<"name" | "contact" | "userId", string>>;

export type ActionResult = {
  ok: boolean;
  message?: string;
  fieldErrors?: FieldErrors;
};

function clean(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function validateTeacher(formData: FormData) {
  const fieldErrors: FieldErrors = {};
  const name = clean(formData.get("name"));
  const contact = clean(formData.get("contact"));
  const userId = clean(formData.get("userId"));

  if (!name) fieldErrors.name = "请填写教师姓名。";
  else if (name.length > 40) fieldErrors.name = "姓名不能超过 40 个字。";
  if (contact.length > 80) fieldErrors.contact = "联系方式不能超过 80 个字。";

  return {
    fieldErrors,
    data: { name, contact: contact || null, userId: userId || null },
  };
}

async function assertLinkableUser(organizationId: string, userId: string | null, teacherId?: string) {
  if (!userId) return null;
  const account = await prisma.user.findFirst({
    where: { id: userId, organizationId },
    select: { id: true },
  });
  if (!account) return "只能关联本机构的登录账号。";

  const taken = await prisma.teacher.findFirst({
    where: { userId, ...(teacherId ? { NOT: { id: teacherId } } : {}) },
    select: { id: true },
  });
  if (taken) return "这个登录账号已经关联了其他教师。";
  return null;
}

export async function createTeacher(formData: FormData): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  const { fieldErrors, data } = validateTeacher(formData);
  const linkError = await assertLinkableUser(user.organizationId, data.userId);
  if (linkError) fieldErrors.userId = linkError;
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  await prisma.teacher.create({
    data: {
      organizationId: user.organizationId,
      name: data.name,
      contact: data.contact,
      userId: data.userId,
    },
  });
  revalidatePath("/owner/teachers");
  return { ok: true };
}

export async function updateTeacher(id: string, formData: FormData): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  const existing = await prisma.teacher.findFirst({
    where: { id, organizationId: user.organizationId },
    select: { id: true },
  });
  if (!existing) return { ok: false, message: "找不到这位教师，或你无权修改。" };

  const { fieldErrors, data } = validateTeacher(formData);
  const linkError = await assertLinkableUser(user.organizationId, data.userId, id);
  if (linkError) fieldErrors.userId = linkError;
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  await prisma.teacher.updateMany({
    where: { id, organizationId: user.organizationId },
    data,
  });
  revalidatePath("/owner/teachers");
  return { ok: true };
}

export async function setTeacherStatus(id: string, status: MemberStatus): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  if (status !== "ACTIVE" && status !== "INACTIVE") return { ok: false, message: "状态无效。" };

  const result = await prisma.teacher.updateMany({
    where: { id, organizationId: user.organizationId },
    data: { status },
  });
  if (result.count !== 1) return { ok: false, message: "找不到这位教师，或你无权修改。" };

  revalidatePath("/owner/teachers");
  return { ok: true };
}
