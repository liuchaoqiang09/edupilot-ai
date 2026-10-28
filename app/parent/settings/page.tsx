import { ParentSettingsPanel } from "@/components/workspace-settings";
import { requireRole } from "@/lib/auth";
import { pick } from "@/lib/locale";

export const dynamic = "force-dynamic";

export default async function ParentSettingsPage() {
  const user = await requireRole("PARENT", "parent");
  return (
    <section>
      <h1 className="text-[28px] font-semibold tracking-tight">{pick(user.locale, "设置", "Settings")}</h1>
      <p className="mt-2 max-w-3xl leading-7 text-[var(--muted)]">
        {pick(
          user.locale,
          "个人查看偏好。绑定孩子与改密码请到「账号管理」；不能在此改课表或交费。",
          "Your viewing preferences. Linked children and password are under Account. No schedule edits or payments here.",
        )}
      </p>
      <div className="mt-5">
        <ParentSettingsPanel />
      </div>
    </section>
  );
}
