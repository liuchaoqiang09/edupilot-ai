import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { registerPhone } from "@/lib/phone-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const ticket = body && typeof body === "object" && "ticket" in body && typeof body.ticket === "string" ? body.ticket : "";
  const name = body && typeof body === "object" && "name" in body && typeof body.name === "string" ? body.name : "";
  const result = await registerPhone(prisma, ticket, name);
  return NextResponse.json({ ok: result.ok, message: result.message, ...(result.ok ? { ticket: result.ticket } : {}) }, { status: result.status });
}
