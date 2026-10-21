import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPhoneCode } from "@/lib/phone-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const phone = body && typeof body === "object" && "phone" in body && typeof body.phone === "string" ? body.phone : "";
  const result = await sendPhoneCode(prisma, phone);
  if (!result.ok) return NextResponse.json({ ok: false, message: result.message }, { status: result.status });
  return NextResponse.json({
    ok: true,
    message: result.message,
    retryAfterSeconds: result.retryAfterSeconds,
    ...(result.devCode ? { devCode: result.devCode } : {}),
  });
}
