import { NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import { homePathForRoles } from "@/lib/roles";
import { SESSION_COOKIE, signSession } from "@/lib/session";

const SESSION_SECONDS = 60 * 60 * 12;

export function sessionResponse(user: { id: string; organizationId: string; roles: Role[] }, message: string) {
  const token = signSession({ sub: user.id, organizationId: user.organizationId, roles: user.roles }, SESSION_SECONDS);
  const response = NextResponse.json({ ok: true, message, redirect: homePathForRoles(user.roles) });
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
