import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";
import { getCurrentUser, redirectToLogin, workspaceHome } from "@/lib/auth";

const areaName: Record<string, string> = {
  owner: "负责人工作空间",
  teacher: "教师工作空间",
  parent: "家长工作空间",
};

export default async function ForbiddenPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirectToLogin();
  const params = await searchParams;
  const target = params.from ? areaName[params.from] : "该工作空间";

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--paper)] px-6">
      <section className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-white p-8">
        <div className="text-[11px] font-extrabold tracking-[2px] text-[var(--teal)]">EDUPILOT AI</div>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">无权访问</h1>
        <p className="mt-3 leading-7 text-[var(--muted)]">
          当前账号不能打开{target || "该工作空间"}。角色由机构授权，不能通过地址或请求参数变更。
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href={workspaceHome(user)} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white">
            返回我的工作台
          </Link>
          <LogoutButton />
        </div>
      </section>
    </main>
  );
}
