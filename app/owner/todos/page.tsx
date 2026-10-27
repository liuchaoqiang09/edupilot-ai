import Link from "next/link";
import { LessonRequestList } from "@/components/lesson-request-list";
import { TodoFocus } from "@/components/todo-focus";
import { requireRole } from "@/lib/auth";
import { formatClock, formatDateLabel, formatDateTime, shanghaiDateKey } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { reportStatusLabel } from "@/lib/report-labels";
import { isTodoGroup, lessonTodoHref, ownerTodoLists, renewalTodoHref, reportTodoHref, waitlistTodoHref } from "@/lib/todo-center";

export default async function OwnerTodosPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string }>;
}) {
  const user = await requireRole("OWNER", "owner");
  const params = await searchParams;
  const group = isTodoGroup(params.group) ? params.group : null;
  const data = await ownerTodoLists(user.organizationId);
  const requests = await prisma.lessonChangeRequest.findMany({
    where: { organizationId: user.organizationId, status: "PENDING" },
    select: {
      id: true, kind: true, startAt: true, endAt: true, note: true,
      requestedBy: { select: { name: true } },
      substituteTeacher: { select: { name: true } },
      lessonSession: { select: { title: true, startAt: true, teacher: { select: { name: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });
  const sections = [
    {
      id: "renewal" as const,
      title: "待续费且没有跟进",
      empty: "没有还没写跟进的续费。已经记过跟进的，仍在报名与课时里。",
      href: data.renewals.length === 1 ? renewalTodoHref(data.renewals[0].key) : "/owner/billing?pin=renewal",
      action: data.renewals.length === 1 ? "打开这条跟进" : "去报名与课时",
      rows: data.renewals.map((row) => ({ key: row.key, title: `${row.studentName} · ${row.courseName}`, detail: row.detail, href: renewalTodoHref(row.key) })),
    },
    {
      id: "records" as const,
      title: "今天已结束但没填教学记录",
      empty: "今天已经结束的课次都有教学记录。",
      href: data.records.length === 1 ? lessonTodoHref(data.records[0].id, shanghaiDateKey(data.records[0].startAt)) : "/owner/schedule?status=待填写",
      action: data.records.length === 1 ? "打开这节课" : "去课表",
      rows: data.records.map((row) => ({
        key: row.id,
        title: row.title ?? row.course.name,
        detail: `${row.teacher.name} · ${formatClock(row.endAt)} 结束`,
        href: lessonTodoHref(row.id, shanghaiDateKey(row.startAt)),
      })),
    },
    {
      id: "reports" as const,
      title: "待确认的报告",
      empty: "没有草稿、已确认或已退回的报告。",
      href: data.reports.length === 1 ? reportTodoHref(data.reports[0].id) : "/owner/reports?all=1&status=待确认",
      action: data.reports.length === 1 ? "打开这份报告" : "去教学报告",
      rows: data.reports.map((row) => ({
        key: row.id,
        title: `${row.student.name} · ${row.lessonSession.title ?? "课次"}`,
        detail: reportStatusLabel[row.status],
        href: reportTodoHref(row.id),
      })),
    },
    {
      id: "trials" as const,
      title: "未转正的试听",
      empty: "没有还没转为报名的试听。",
      href: data.trials.length === 1 ? lessonTodoHref(data.trials[0].lessonSession.id, shanghaiDateKey(data.trials[0].lessonSession.startAt)) : "/owner/schedule",
      action: data.trials.length === 1 ? "打开这节试听" : "去课表",
      rows: data.trials.map((row) => ({
        key: row.id,
        title: `${row.student.name} · ${row.lessonSession.title ?? "课次"}`,
        detail: `${formatDateLabel(shanghaiDateKey(row.lessonSession.startAt))} ${formatClock(row.lessonSession.startAt)}`,
        href: lessonTodoHref(row.lessonSession.id, shanghaiDateKey(row.lessonSession.startAt)),
      })),
    },
    {
      id: "waitlist" as const,
      title: "已满且有人排队的班级",
      empty: "没有又满、又有人排队的班级。",
      href: data.fullQueues.length === 1 ? waitlistTodoHref(data.fullQueues[0].id) : "/owner/courses",
      action: data.fullQueues.length === 1 ? "打开排队" : "去课程与班级",
      rows: data.fullQueues.map((row) => ({
        key: row.id,
        title: `${row.name} · ${row.courseName}`,
        detail: `在读 ${row.enrolled} / ${row.capacity}，排队 ${row.waiting.join("、")}`,
        href: waitlistTodoHref(row.id),
      })),
    },
  ];

  return (
    <section>
      <TodoFocus group={group} />
      <h1 className="text-[28px] font-semibold tracking-tight">待办中心</h1>
      <p className="mt-2 max-w-2xl text-sm leading-7 text-[var(--muted)]">点一条，直接打开要处理的那一处：跟进表、课次详情、报告正文或排队窗口。只有一条时，工作台上的入口也直接打开它。</p>
      <div className="mt-6 grid gap-4">
        <LessonRequestList
          rows={requests.map((row) => ({
            id: row.id,
            title: `${row.lessonSession.teacher.name} · ${row.lessonSession.title ?? "课次"}`,
            detail: row.kind === "RESCHEDULE" && row.startAt && row.endAt
              ? `${row.requestedBy.name}申请把 ${formatDateTime(row.lessonSession.startAt)} 改到 ${formatDateTime(row.startAt)}–${formatClock(row.endAt)}${row.note ? `。${row.note}` : ""}`
              : `${row.requestedBy.name}申请由${row.substituteTeacher?.name ?? "另一位教师"}代 ${formatDateTime(row.lessonSession.startAt)} 这节课${row.note ? `。${row.note}` : ""}`,
          }))}
        />
        {sections.map((section) => (
          <section key={section.id} id={`todo-${section.id}`} className={`scroll-mt-24 overflow-hidden rounded-2xl border bg-white ${group === section.id ? "border-[#e7c27a]" : "border-[var(--line)]"}`}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf0ee] px-5 py-4">
              <h2 className="text-sm font-semibold">{section.title}</h2>
              <span className="flex items-center gap-3">
                <span className="rounded-full bg-[#fff2df] px-2 py-1 text-[10px] font-bold text-[#9a6729]">{section.rows.length}</span>
                <Link href={section.href} className="text-xs font-bold text-[var(--teal)]">{section.action} →</Link>
              </span>
            </div>
            {section.rows.length === 0 ? <p className="px-5 py-8 text-sm text-[var(--muted)]">{section.empty}</p> : (
              <ul>
                {section.rows.map((row) => (
                  <li key={row.key} id={`todo-${section.id}-${row.key}`} className="scroll-mt-24 border-t border-[#eef1ee]">
                    <Link href={row.href} className="block px-5 py-3 text-xs hover:bg-[#f7faf8]">
                      <strong className="block">{row.title}</strong>
                      <span className="mt-1 block text-[var(--muted)]">{row.detail}</span>
                      <span className="mt-1 block font-bold text-[var(--teal)]">打开这条 →</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </section>
  );
}
