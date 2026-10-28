import Link from "next/link";
import { markNoticesRead } from "@/app/parent/notices/actions";
import { requireRole } from "@/lib/auth";
import { formatDateTime } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";

const kindLabel = {
  LESSON: "课次",
  HOMEWORK: "作业",
  REPORT: "报告",
  MAKEUP: "补课",
  EXAM: "成绩",
} as const;

export default async function ParentNoticesPage() {
  const user = await requireRole("PARENT", "parent");
  const notices = await prisma.parentNotice.findMany({
    where: { organizationId: user.organizationId, parentUserId: user.id },
    orderBy: [{ readAt: "asc" }, { createdAt: "desc" }],
    take: 50,
  });
  const unread = notices.filter((notice) => !notice.readAt).length;

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">消息</h1>
          <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">调课、停课、换教室、代课、新作业、成绩发布、已发布报告和补课安排会留在这里。短信还没有开通，系统不会假装已经发出短信。</p>
        </div>
        {unread > 0 ? (
          <form action={markNoticesRead}>
            <button className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">全部标为已读</button>
          </form>
        ) : null}
      </div>
      {notices.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-[var(--line)] bg-white px-5 py-12 text-center leading-7 text-[var(--muted)]">还没有消息。之后的课次变动、作业和报告会显示在这里。</p>
      ) : (
        <ul className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
          {notices.map((notice) => (
            <li key={notice.id} className="border-b border-[#eef1ee] last:border-b-0">
              <Link href={`/parent/notices/go?id=${notice.id}`} className="flex w-full items-start justify-between gap-3 px-5 py-4 text-left">
                <span>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[#edf5f1] px-2 py-1 text-[10px] font-bold text-[#34725d]">{kindLabel[notice.kind]}</span>
                    <span className={`text-sm ${notice.readAt ? "font-medium" : "font-bold"}`}>{notice.title}</span>
                    {notice.readAt ? null : <span className="text-[10px] font-bold text-[var(--teal)]">未读</span>}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">{notice.body}</span>
                </span>
                <span className="shrink-0 text-[11px] text-[var(--muted)]">{formatDateTime(notice.createdAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
