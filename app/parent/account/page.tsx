import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function ParentAccountPage() {
  const user = await requireRole("PARENT", "parent");
  const links = await prisma.parentStudentLink.findMany({
    where: { organizationId: user.organizationId, parentUserId: user.id },
    include: { student: { select: { name: true, studentNo: true, grade: true, status: true } } },
    orderBy: { createdAt: "asc" },
  });

  return (
    <section className="max-w-2xl">
      <h1 className="text-[28px] font-semibold tracking-tight">账号 / 绑定信息</h1>
      <p className="mt-2 leading-7 text-[var(--muted)]">这里只显示已经绑定到当前账号的孩子。新的绑定需要机构负责人签发的绑定码。</p>
      <div className="mt-5 rounded-2xl border border-[var(--line)] bg-white p-5 text-sm">
        <div className="font-semibold">{user.name}</div>
        <div className="mt-1 text-xs text-[var(--muted)]">{user.phone ?? user.email}</div>
        <p className="mt-3 text-xs text-[var(--muted)]">绑定手机号即将上线</p>
      </div>
      <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        <div className="border-b border-[#eef1ee] px-4 py-3 text-sm font-semibold">已绑定孩子 · {links.length}</div>
        {links.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm leading-7 text-[var(--muted)]">还没有绑定孩子。请使用负责人发给你的绑定码，不能凭学生姓名或编号自行绑定。</p>
        ) : (
          <ul>
            {links.map((link) => (
              <li key={link.id} className="border-t border-[#eef1ee] px-4 py-4 first:border-t-0">
                <div className="text-sm font-bold">{link.student.name}</div>
                <div className="mt-1 text-xs text-[var(--muted)]">{link.student.grade ?? "未填写年级"} · {link.student.studentNo ?? "无编号"}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
