import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { pick } from "@/lib/locale";
import { prisma } from "@/lib/prisma";

const pageSize = 20;

const actionLabel: Record<string, [string, string]> = {
  HOUR_ADJUST: ["调整课时", "Hour change"],
  PAYMENT_COLLECT: ["收款", "Payment"],
  PAYMENT_REFUND: ["退费", "Refund"],
  PAYMENT_VOID: ["作废流水", "Void payment"],
  STUDENT_DEACTIVATED: ["停用学生", "Deactivate student"],
  ROSTER_REMOVED: ["移出课次", "Remove from lesson"],
  ROSTER_ADDED: ["加入课次", "Add to lesson"],
  LESSON_CANCELLED: ["取消课次", "Cancel lesson"],
  LESSON_RESCHEDULED: ["修改上课时间", "Reschedule lesson"],
  LESSON_ROOM_CHANGED: ["修改课次教室", "Change lesson room"],
  TRIAL_CONVERTED: ["试听转报名", "Convert trial"],
  MAKEUP_SCHEDULED: ["安排补课", "Schedule makeup"],
  REPORT_PUBLISHED: ["发布报告", "Publish report"],
  REPORT_RETURNED: ["退回报告", "Return report"],
};

export default async function OwnerAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; page?: string }>;
}) {
  const user = await requireRole("OWNER", "owner");
  const params = await searchParams;
  const action = params.action && actionLabel[params.action] ? params.action : "";
  const page = Math.max(1, Number(params.page) || 1);
  const where = { organizationId: user.organizationId, ...(action ? { action } : {}) };
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, action: true, detail: true, createdAt: true, actor: { select: { name: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const t = (zh: string, en: string) => pick(user.locale, zh, en);
  const href = (nextPage: number, nextAction = action) => {
    const search = new URLSearchParams();
    if (nextAction) search.set("action", nextAction);
    if (nextPage > 1) search.set("page", String(nextPage));
    const text = search.toString();
    return text ? `/owner/audit?${text}` : "/owner/audit";
  };

  return (
    <section>
      <h1 className="text-[28px] font-semibold tracking-tight">{t("操作记录", "Activity")}</h1>
      <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">{t("按时间从新到旧。课时调整、收款、退费和作废都记在这里。", "Newest first. Hour changes, payments, refunds, and voids are listed here.")}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={href(1, "")} className={`rounded-full px-3 py-1.5 text-xs font-bold ${action === "" ? "bg-[var(--teal)] text-white" : "border border-[var(--line)] bg-white"}`}>{t("全部", "All")}</Link>
        {Object.entries(actionLabel).map(([key, label]) => (
          <Link key={key} href={href(1, key)} className={`rounded-full px-3 py-1.5 text-xs font-bold ${action === key ? "bg-[var(--teal)] text-white" : "border border-[var(--line)] bg-white"}`}>
            {t(label[0], label[1])}
          </Link>
        ))}
      </div>
      <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        {rows.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-[var(--muted)]">{t("还没有操作记录。", "No activity yet.")}</p>
        ) : (
          <ul>
            {rows.map((row) => (
              <li key={row.id} className="border-b border-[#eef1ee] px-5 py-4 last:border-b-0">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-bold">{t(actionLabel[row.action]?.[0] ?? row.action, actionLabel[row.action]?.[1] ?? row.action)}</span>
                  <span className="text-[var(--muted)]">{row.createdAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hourCycle: "h23" })} · {row.actor.name}</span>
                </div>
                <p className="mt-1 text-sm leading-6">{row.detail ?? t("没有补充说明。", "No detail.")}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-4 flex items-center justify-between text-xs">
        <span className="text-[var(--muted)]">{t(`第 ${page} / ${pages} 页`, `Page ${page} of ${pages}`)}</span>
        <span className="flex gap-3 font-bold">
          {page > 1 ? <Link href={href(page - 1)} className="text-[var(--teal)]">{t("上一页", "Previous")}</Link> : null}
          {page < pages ? <Link href={href(page + 1)} className="text-[var(--teal)]">{t("下一页", "Next")}</Link> : null}
        </span>
      </div>
    </section>
  );
}
