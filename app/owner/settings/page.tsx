import { OwnerSettingsForm } from "@/components/owner-settings";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function OwnerSettingsPage() {
  const user = await requireRole("OWNER", "owner");
  const organization = await prisma.organization.findUnique({
    where: { id: user.organizationId },
  });
  if (!organization) {
    return <p className="text-sm text-[var(--muted)]">没有找到当前机构。</p>;
  }

  return (
    <section>
      <h1 className="text-[28px] font-semibold tracking-tight">机构设置</h1>
      <p className="mt-2 max-w-3xl leading-7 text-[var(--muted)]">配置机构业务和教学评价规则。业务可以自定义，底层权限与数据隔离不可关闭。</p>
      <div className="mt-5">
        <OwnerSettingsForm
          settings={{
            name: organization.name,
            timezone: organization.timezone,
            reportLanguage: organization.reportLanguage,
            businessTypes: organization.businessTypes,
            aiUseRecentSummaries: organization.aiUseRecentSummaries,
            aiRequireEvidence: organization.aiRequireEvidence,
            aiTeacherMustConfirm: organization.aiTeacherMustConfirm,
            aiOwnerSpotCheck: organization.aiOwnerSpotCheck,
          }}
        />
      </div>
    </section>
  );
}
