import { WorkspaceShell } from "@/components/workspace-shell";
import { requireRole } from "@/lib/auth";

export default async function ParentLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("PARENT", "parent");
  return (
    <WorkspaceShell area="parent" user={{ name: user.name, roles: user.roles, organizationName: user.organizationName }}>
      {children}
    </WorkspaceShell>
  );
}
