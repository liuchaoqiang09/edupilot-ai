import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { homePathForRoles } from "@/lib/roles";
import { signSession, SESSION_COOKIE } from "@/lib/session";

const SESSION_SECONDS = 60 * 60 * 12;
const REMEMBER_SECONDS = 60 * 60 * 24 * 14;

let dummyHash: Promise<string> | null = null;

function placeholderHash() {
  dummyHash ??= bcrypt.hash("edupilot-unused-password", 12);
  return dummyHash;
}

export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown; remember?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "请输入账号和密码。" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const remember = body.remember === true;

  if (!email || !password || email.length > 200 || password.length > 200) {
    return NextResponse.json({ message: "请输入账号和密码。" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { organization: true },
  });
  const hash = user?.passwordHash ?? (await placeholderHash());
  const matched = await bcrypt.compare(password, hash);

  if (!user || !matched || user.roles.length === 0) {
    return NextResponse.json({ message: "账号或密码不正确。" }, { status: 401 });
  }

  const maxAge = remember ? REMEMBER_SECONDS : SESSION_SECONDS;
  let token: string;
  try {
    token = signSession(
      {
        sub: user.id,
        organizationId: user.organizationId,
        roles: user.roles,
      },
      maxAge,
    );
  } catch {
    return NextResponse.json({ message: "服务器缺少会话配置，暂时无法登录。" }, { status: 500 });
  }

  const response = NextResponse.json({ redirect: homePathForRoles(user.roles) });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
  return response;
}
