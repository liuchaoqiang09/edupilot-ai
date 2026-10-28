import { TeacherSettingsPanel } from "@/components/workspace-settings";
import { requireRole } from "@/lib/auth";
import { pick } from "@/lib/locale";

export const dynamic = "force-dynamic";

export default async function TeacherSettingsPage() {
  const user = await requireRole("TEACHER", "teacher");
  return (
    <section>
      <h1 className="text-[28px] font-semibold tracking-tight">{pick(user.locale, "设置", "Settings")}</h1>
      <p className="mt-2 max-w-3xl leading-7 text-[var(--muted)]">
        {pick(
          user.locale,
          "个人工作台偏好。点名与课时规则仍由机构统一；密码与登录请到「账号管理」。",
          "Your workspace preferences. Attendance rules stay with the organization. Password is under Account.",
        )}
      </p>
      <div className="mt-5">
        <TeacherSettingsPanel />
      </div>
    </section>
  );
}
