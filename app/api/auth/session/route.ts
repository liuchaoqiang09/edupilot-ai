import { NextResponse } from "next/server";
import { getCurrentUser, workspaceHome } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/session";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (user) {
    return NextResponse.redirect(new URL(workspaceHome(user), request.url));
  }

  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
