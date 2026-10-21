import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPhoneCode } from "@/lib/phone-auth";
import { homePathForRoles } from "@/lib/roles";
import { SESSION_COOKIE, signSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_SECONDS = 60 * 60 * 12;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const phone = body && typeof body === "object" && "phone" in body && typeof body.phone === "string" ? body.phone : "";
  const code = body && typeof body === "object" && "code" in body && typeof body.code === "string" ? body.code : "";
  const result = await verifyPhoneCode(prisma, phone, code);
  if (!result.ok) return NextResponse.json({ ok: false, message: result.message }, { status: result.status });
  if (result.kind === "pending") {
    return NextResponse.json({ ok: true, status: "pending", ticket: result.ticket, message: result.message });
  }
  if (result.kind === "register") {
    return NextResponse.json({ ok: true, status: "register", ticket: result.ticket, message: result.message });
  }
  if (result.user.roles.length === 0) {
    return NextResponse.json({ ok: false, message: "这个账号还没有被分配角色，暂时不能进入工作台。" }, { status: 403 });
  }

  let token: string;
  try {
    token = signSession({ sub: result.user.id, organizationId: result.user.organizationId, roles: result.user.roles }, SESSION_SECONDS);
  } catch {
    return NextResponse.json({ ok: false, message: "服务器缺少会话配置，暂时无法登录。" }, { status: 500 });
  }
  const response = NextResponse.json({ ok: true, status: "login", redirect: homePathForRoles(result.user.roles) });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return response;
}
