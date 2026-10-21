import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function ParentHomePage() {
  const user = await requireRole("PARENT", "parent");
  const links = await prisma.parentStudentLink.findMany({
    where: { organizationId: user.organizationId, parentUserId: user.id },
    include: {
      student: { select: { name: true, grade: true, studentNo: true, status: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <section>
      <h1 className="text-[28px] font-semibold tracking-tight">我的孩子</h1>
      <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">这里只显示机构已经绑定到你账号上的学生。</p>
      <div className="mt-6 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        {links.length === 0 ? (
          <p className="px-4 py-12 text-center leading-7 text-[var(--muted)]">还没有绑定的孩子。请让机构负责人在学生档案里完成绑定。</p>
        ) : (
          <ul>
            {links.map((link) => (
              <li key={link.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-[#eef1ee] px-4 py-4 first:border-t-0">
                <div>
                  <div className="text-sm font-bold">{link.student.name}</div>
                  <div className="mt-1 text-xs text-[var(--muted)]">{link.student.grade ?? "未填写年级"} · {link.student.studentNo ?? "无编号"}</div>
                </div>
                <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${link.student.status === "ACTIVE" ? "bg-[#edf5f1] text-[#34725d]" : "bg-[#fff2df] text-[#9a6729]"}`}>
                  {link.student.status === "ACTIVE" ? "在读" : "已停用"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
