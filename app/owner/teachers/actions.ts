"use server";

import { revalidatePath } from "next/cache";
import { MemberStatus } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type FieldErrors = Partial<Record<"name" | "contact" | "link", string>>;

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
  const link = clean(formData.get("link")) === "1";

  if (!name) fieldErrors.name = "请填写教师姓名。";
  else if (name.length > 40) fieldErrors.name = "姓名不能超过 40 个字。";
  if (contact.length > 80) fieldErrors.contact = "联系方式不能超过 80 个字。";

  return { fieldErrors, data: { name, contact: contact || null, link } };
}

function refreshTeachers() {
  revalidatePath("/owner/teachers");
  revalidatePath("/owner/schedule");
}

export async function createTeacher(formData: FormData): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  const { fieldErrors, data } = validateTeacher(formData);
  if (data.link) fieldErrors.link = "新老师默认暂不关联。保存档案后，把邀请码发给对方，注册成功会自动关联。";
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  await prisma.teacher.create({
    data: { organizationId: user.organizationId, name: data.name, contact: data.contact },
  });
  refreshTeachers();
  return { ok: true };
}

export async function updateTeacher(id: string, formData: FormData): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  const existing = await prisma.teacher.findFirst({
    where: { id, organizationId: user.organizationId },
    select: { id: true, accountUserId: true },
  });
  if (!existing) return { ok: false, message: "找不到这位教师，或你无权修改。" };

  const { fieldErrors, data } = validateTeacher(formData);
  if (data.link && !existing.accountUserId) {
    fieldErrors.link = "这位老师还没有注册。把邀请码发给对方后会自动关联，密码只有老师自己知道。";
  }
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  let userId: string | null = null;
  if (data.link && existing.accountUserId) {
    const account = await prisma.user.findFirst({
      where: { id: existing.accountUserId, organizationId: user.organizationId, roles: { has: "TEACHER" } },
      select: { id: true },
    });
    if (!account) return { ok: false, fieldErrors: { link: "这位老师的登录账号已不在本机构。" } };
    const taken = await prisma.teacher.findFirst({
      where: { userId: account.id, NOT: { id } },
      select: { id: true },
    });
    if (taken) return { ok: false, fieldErrors: { link: "这个登录账号已经关联了其他教师。" } };
    userId = account.id;
  }

  const updated = await prisma.teacher.updateMany({
    where: { id, organizationId: user.organizationId },
    data: { name: data.name, contact: data.contact, userId },
  });
  if (updated.count !== 1) return { ok: false, message: "找不到这位教师，或你无权修改。" };

  refreshTeachers();
  return { ok: true };
}

export async function revokeTeacherLogin(id: string): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  const existing = await prisma.teacher.findFirst({
    where: { id, organizationId: user.organizationId },
    select: { id: true, userId: true },
  });
  if (!existing) return { ok: false, message: "找不到这位教师，或你无权修改。" };
  if (!existing.userId) return { ok: false, message: "这位老师当前没有关联账号。" };

  const result = await prisma.teacher.updateMany({
    where: { id, organizationId: user.organizationId },
    data: { userId: null },
  });
  if (result.count !== 1) return { ok: false, message: "找不到这位教师，或你无权修改。" };

  refreshTeachers();
  return { ok: true, message: "已收回。这位老师暂时不能进入课表，密码没有改变。" };
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
