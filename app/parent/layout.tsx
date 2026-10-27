import { LocaleProvider } from "@/components/locale-provider";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function ParentLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("PARENT", "parent");
  const noticeCount = await prisma.parentNotice.count({
    where: { organizationId: user.organizationId, parentUserId: user.id, readAt: null },
  });
  return (
    <LocaleProvider locale={user.locale}>
      <WorkspaceShell area="parent" noticeCount={noticeCount} user={{ name: user.name, roles: user.roles, organizationName: user.organizationName }}>
        {children}
      </WorkspaceShell>
    </LocaleProvider>
  );
}
