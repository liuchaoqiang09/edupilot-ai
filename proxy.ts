import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { areaFromPath, areaRole, homePathForRoles } from "@/lib/roles";
import { readSession, SESSION_COOKIE } from "@/lib/session";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = readSession(request.cookies.get(SESSION_COOKIE)?.value);
  const area = areaFromPath(pathname);

  if (area) {
    if (!session) {
      const login = new URL("/login", request.url);
      return NextResponse.redirect(login);
    }
    if (!session.roles.includes(areaRole[area])) {
      const denied = new URL("/forbidden", request.url);
      denied.searchParams.set("from", area);
      return NextResponse.redirect(denied);
    }
    return NextResponse.next();
  }

  if ((pathname === "/login" || pathname === "/") && session) {
    return NextResponse.redirect(new URL(homePathForRoles(session.roles), request.url));
  }

  if (pathname === "/" && !session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (pathname === "/forbidden" && !session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|api/auth).*)"],
};
