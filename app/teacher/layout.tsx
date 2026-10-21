import { WorkspaceShell } from "@/components/workspace-shell";
import { requireRole } from "@/lib/auth";

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("TEACHER", "teacher");
  return (
    <WorkspaceShell area="teacher" user={{ name: user.name, roles: user.roles, organizationName: user.organizationName }}>
      {children}
    </WorkspaceShell>
  );
}
