import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { normalizeLocale, type Locale } from "@/lib/locale";
import { prisma } from "@/lib/prisma";
import { homePathForRoles, type WorkspaceArea } from "@/lib/roles";
import { readSession, SESSION_COOKIE } from "@/lib/session";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  roles: Role[];
  organizationId: string;
  organizationName: string;
  locale: Locale;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const jar = await cookies();
  const session = readSession(jar.get(SESSION_COOKIE)?.value);
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    include: { organization: true },
  });

  if (!user || user.organizationId !== session.organizationId) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    roles: user.roles,
    organizationId: user.organizationId,
    organizationName: user.organization.name,
    locale: normalizeLocale(user.organization.reportLanguage),
  };
}

export function redirectToLogin(): never {
  redirect("/api/auth/session");
}

export async function requireRole(role: Role, area: WorkspaceArea): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirectToLogin();
  if (!user.roles.includes(role)) redirect(`/forbidden?from=${area}`);
  return user;
}

export function workspaceHome(user: CurrentUser) {
  return homePathForRoles(user.roles);
}
