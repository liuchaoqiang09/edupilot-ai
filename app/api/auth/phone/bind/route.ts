import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { bindUserPhone } from "@/lib/membership";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "请先登录。" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const password = body && typeof body === "object" && "password" in body && typeof body.password === "string" ? body.password : "";
  const phone = body && typeof body === "object" && "phone" in body && typeof body.phone === "string" ? body.phone : "";
  const code = body && typeof body === "object" && "code" in body && typeof body.code === "string" ? body.code : "";
  const result = await bindUserPhone(prisma, user.id, password, phone, code);
  return NextResponse.json({ ok: result.ok, message: result.message }, { status: result.status });
}
