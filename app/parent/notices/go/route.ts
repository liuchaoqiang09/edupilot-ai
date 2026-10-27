import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { safeParentHref } from "@/lib/parent-scope";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !user.roles.includes("PARENT")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const id = request.nextUrl.searchParams.get("id") ?? "";
  const notice = await prisma.parentNotice.findFirst({
    where: { id, organizationId: user.organizationId, parentUserId: user.id },
    select: { id: true, href: true, readAt: true },
  });
  if (!notice) {
    return NextResponse.redirect(new URL("/parent/notices", request.url));
  }
  if (!notice.readAt) {
    await prisma.parentNotice.updateMany({
      where: { id: notice.id, organizationId: user.organizationId, parentUserId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
  }
  return NextResponse.redirect(new URL(safeParentHref(notice.href), request.url));
}
