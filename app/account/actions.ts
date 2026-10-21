"use server";

import bcrypt from "bcryptjs";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type PasswordResult = { ok: boolean; message: string };

function text(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : "";
}

export async function changeOwnPassword(formData: FormData): Promise<PasswordResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "请先登录。" };

  const current = text(formData.get("current"));
  const next = text(formData.get("next"));
  const confirm = text(formData.get("confirm"));
  if (!current || !next) return { ok: false, message: "请填写当前密码和新密码。" };
  if (next !== confirm) return { ok: false, message: "两次输入的新密码不一致。" };
  if (next.length < 8 || next.length > 64) return { ok: false, message: "新密码需要 8 到 64 位。" };

  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
  if (!row || !(await bcrypt.compare(current, row.passwordHash))) return { ok: false, message: "当前密码不正确。" };
  if (current === next) return { ok: false, message: "新密码不能与当前密码相同。" };

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(next, 12) },
  });
  return { ok: true, message: "密码已修改。下次登录请使用新密码。" };
}
