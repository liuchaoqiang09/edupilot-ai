import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { consumePhoneCode } from "@/lib/phone-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const phone = body && typeof body === "object" && "phone" in body && typeof body.phone === "string" ? body.phone : "";
  const code = body && typeof body === "object" && "code" in body && typeof body.code === "string" ? body.code : "";
  const password = body && typeof body === "object" && "password" in body && typeof body.password === "string" ? body.password : "";
  const confirm = body && typeof body === "object" && "confirm" in body && typeof body.confirm === "string" ? body.confirm : "";

  if (password !== confirm) return NextResponse.json({ message: "两次输入的新密码不一致。" }, { status: 400 });
  if (password.length < 8 || password.length > 64) return NextResponse.json({ message: "新密码需要 8 到 64 位。" }, { status: 400 });

  const proof = await consumePhoneCode(prisma, phone, code);
  if (!proof.ok) return NextResponse.json({ message: proof.message }, { status: proof.status });

  const user = await prisma.user.findUnique({ where: { phone: proof.phone }, select: { id: true } });
  if (!user) return NextResponse.json({ message: "这个手机号还没有绑定登录账号。" }, { status: 404 });

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(password, 12) },
  });
  return NextResponse.json({ message: "密码已重置。请用新密码登录。" });
}
