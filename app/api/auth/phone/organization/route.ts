import { NextResponse } from "next/server";
import { createOrganizationForSignup } from "@/lib/membership";
import { prisma } from "@/lib/prisma";
import { sessionResponse } from "@/lib/session-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const ticket = body && typeof body === "object" && "ticket" in body && typeof body.ticket === "string" ? body.ticket : "";
  const name = body && typeof body === "object" && "name" in body && typeof body.name === "string" ? body.name : "";
  const result = await createOrganizationForSignup(prisma, ticket, name);
  if (!result.ok) return NextResponse.json({ ok: false, message: result.message }, { status: result.status });
  return sessionResponse(result.user, result.message);
}
