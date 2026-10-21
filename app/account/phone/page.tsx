import { redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getCurrentUser, redirectToLogin } from "@/lib/auth";
import { homePathForRoles, type WorkspaceArea } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function BindPhonePage() {
  const user = await getCurrentUser();
  if (!user) redirectToLogin();
  const area: WorkspaceArea | null = user.roles.includes("OWNER")
    ? "owner"
    : user.roles.includes("TEACHER")
      ? "teacher"
      : user.roles.includes("PARENT")
        ? "parent"
        : null;
  if (!area) redirect("/forbidden");

  return (
    <WorkspaceShell area={area} user={{ name: user.name, roles: user.roles, organizationName: user.organizationName }}>
      <section className="max-w-xl">
        <h1 className="text-[28px] font-semibold tracking-tight">绑定手机号</h1>
        <p className="mt-2 leading-7 text-[var(--muted)]">短信验证尚未对内测开放。</p>
        <div className="mt-5 rounded-2xl border border-[var(--line)] bg-white p-5 text-sm leading-7 text-[var(--muted)]">绑定手机号即将上线。当前请继续使用账号密码登录。</div>
        <a href={homePathForRoles(user.roles)} className="mt-4 inline-block text-sm font-semibold text-[var(--teal)]">返回工作台</a>
      </section>
    </WorkspaceShell>
  );
}
