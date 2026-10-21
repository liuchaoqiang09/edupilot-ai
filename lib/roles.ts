import type { Role } from "@prisma/client";

export type WorkspaceArea = "owner" | "teacher" | "parent";

export const areaRole: Record<WorkspaceArea, Role> = {
  owner: "OWNER",
  teacher: "TEACHER",
  parent: "PARENT",
};

export function homePathForRoles(roles: Role[]) {
  if (roles.includes("OWNER")) return "/owner";
  if (roles.includes("TEACHER")) return "/teacher";
  if (roles.includes("PARENT")) return "/parent";
  return "/forbidden";
}

export function areaFromPath(pathname: string): WorkspaceArea | null {
  if (pathname === "/owner" || pathname.startsWith("/owner/")) return "owner";
  if (pathname === "/teacher" || pathname.startsWith("/teacher/")) return "teacher";
  if (pathname === "/parent" || pathname.startsWith("/parent/")) return "parent";
  return null;
}
