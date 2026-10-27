import { LocaleProvider } from "@/components/locale-provider";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireRole } from "@/lib/auth";

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("OWNER", "owner");
  return (
    <LocaleProvider locale={user.locale}>
      <WorkspaceShell area="owner" user={{ name: user.name, roles: user.roles, organizationName: user.organizationName }}>
        {children}
      </WorkspaceShell>
    </LocaleProvider>
  );
}
