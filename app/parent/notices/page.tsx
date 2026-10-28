import Link from "next/link";
import { markNoticesRead } from "@/app/parent/notices/actions";
import { ParentTimeOrder } from "@/components/parent-time-order";
import { Pager, billingPageSize, pageOf } from "@/components/pager";
import { requireRole } from "@/lib/auth";
import { formatDateTime } from "@/lib/datetime";
import {
  legacyNoticeParams,
  noticeKindLabel,
  noticeKindTabs,
  noticeListHref,
  noticeOrderBy,
  noticeStatusTabs,
  noticeWhere,
  parseNoticeKind,
  parseNoticeOrder,
  parseNoticeStatus,
  type NoticeKindTab,
  type NoticeStatus,
} from "@/lib/parent-notices-ui";
import { prisma } from "@/lib/prisma";

export default async function ParentNoticesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; status?: string; kind?: string; page?: string; order?: string }>;
}) {
  const user = await requireRole("PARENT", "parent");
  const params = await searchParams;
  const legacy = legacyNoticeParams(params.tab);
  const status = parseNoticeStatus(params.status ?? legacy.status);
  const kind = parseNoticeKind(params.kind ?? legacy.kind);
  const order = parseNoticeOrder(params.order);

  const baseWhere = noticeWhere({
    organizationId: user.organizationId,
    parentUserId: user.id,
    status: "all",
    kind: "all",
  });
  const where = noticeWhere({
    organizationId: user.organizationId,
    parentUserId: user.id,
    status,
    kind,
  });

  const [total, unreadTotal, readTotal] = await Promise.all([
    prisma.parentNotice.count({ where }),
    prisma.parentNotice.count({ where: { ...baseWhere, readAt: null } }),
    prisma.parentNotice.count({ where: { ...baseWhere, readAt: { not: null } } }),
  ]);
  const window = pageOf(params.page, total, billingPageSize);
  const rows = await prisma.parentNotice.findMany({
    where,
    orderBy: noticeOrderBy(order),
    skip: window.start,
    take: billingPageSize,
  });

  const href = (next: {
    page?: number;
    status?: NoticeStatus;
    kind?: NoticeKindTab;
    order?: "asc" | "desc";
  }) =>
    noticeListHref({
      status: next.status ?? status,
      kind: next.kind ?? kind,
      order: next.order ?? order,
      page: next.page ?? 1,
    });

  const emptyHint =
    status === "unread"
      ? kind === "all"
        ? "没有未读消息。"
        : `没有未读的「${noticeKindLabel[kind]}」消息。`
      : status === "read"
        ? kind === "all"
          ? "还没有已读消息。"
          : `没有已读的「${noticeKindLabel[kind]}」消息。`
        : kind === "all"
          ? "还没有消息。之后的课次变动、作业和报告会显示在这里。"
          : `没有「${noticeKindLabel[kind]}」类消息。`;

  const orderParams: Record<string, string> = {};
  if (status !== "all") orderParams.status = status;
  if (kind !== "all") orderParams.kind = kind;

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">消息</h1>
          <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">
            按已读状态与类型筛选，并按相关时间从新到旧或从旧到新查看。每页 {billingPageSize} 条。短信还没有开通。
          </p>
        </div>
        {unreadTotal > 0 ? (
          <form action={markNoticesRead}>
            <button className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">
              全部标为已读（{unreadTotal}）
            </button>
          </form>
        ) : null}
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold text-[var(--muted)]">状态</span>
          {noticeStatusTabs.map((item) => {
            const active = status === item.id;
            const badge =
              item.id === "unread" && unreadTotal > 0
                ? unreadTotal
                : item.id === "read" && readTotal > 0
                  ? readTotal
                  : null;
            return (
              <Link
                key={item.id}
                href={href({ page: 1, status: item.id })}
                className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                  active ? "bg-[var(--teal)] text-white" : "border border-[var(--line)] bg-white text-[#385058]"
                }`}
              >
                {item.label}
                {badge != null ? <span className="ml-1 opacity-90">{badge > 99 ? "99+" : badge}</span> : null}
              </Link>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold text-[var(--muted)]">类型</span>
            {noticeKindTabs.map((item) => {
              const active = kind === item.id;
              return (
                <Link
                  key={item.id}
                  href={href({ page: 1, kind: item.id })}
                  className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                    active ? "bg-[var(--teal)] text-white" : "border border-[var(--line)] bg-white text-[#385058]"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
          <ParentTimeOrder basePath="/parent/notices" order={order} extraParams={orderParams} />
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        {rows.length === 0 ? (
          <p className="px-5 py-12 text-center leading-7 text-[var(--muted)]">{emptyHint}</p>
        ) : (
          <ul>
            {rows.map((notice) => (
              <li key={notice.id} className="border-b border-[#eef1ee] last:border-b-0">
                <Link
                  href={`/parent/notices/go?id=${notice.id}`}
                  className="flex w-full items-start justify-between gap-3 px-5 py-4 text-left"
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-[#edf5f1] px-2 py-1 text-[10px] font-bold text-[#34725d]">
                        {noticeKindLabel[notice.kind]}
                      </span>
                      <span className={`text-sm ${notice.readAt ? "font-medium text-[#5a6b72]" : "font-bold"}`}>
                        {notice.title}
                      </span>
                      {notice.readAt ? (
                        <span className="text-[10px] font-bold text-[#84918e]">已读</span>
                      ) : (
                        <span className="text-[10px] font-bold text-[var(--teal)]">未读</span>
                      )}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">{notice.body}</span>
                  </span>
                  <span className="shrink-0 text-right text-[11px] leading-5 text-[var(--muted)]">
                    <span className="block">{formatDateTime(notice.occurredAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Pager page={window.page} pages={window.pages} href={(next) => href({ page: next })} size={billingPageSize} />
      </div>
    </section>
  );
}
