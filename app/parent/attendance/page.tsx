import Link from "next/link";
import { DateField } from "@/components/date-field";
import { ParentChildFilter } from "@/components/parent-child-filter";
import { requireRole } from "@/lib/auth";
import { dayRange, formatClock, formatDateLabel, shanghaiDateKey, shanghaiWeekRange, shiftDate } from "@/lib/datetime";
import { attendanceDisplayLabel, attendanceDisplayTone } from "@/lib/leave-kind";
import { linkedParentChildren, parentVisibleLessonFilter, pickLinkedChildId } from "@/lib/parent-scope";
import { prisma } from "@/lib/prisma";

const presets = [
  { id: "all", label: "全部" },
  { id: "week", label: "本周" },
  { id: "month", label: "本月" },
  { id: "last7", label: "近 7 天" },
  { id: "upcoming", label: "以后的课" },
] as const;

type Preset = (typeof presets)[number]["id"];

function presetId(value: string | undefined): Preset {
  return presets.some((item) => item.id === value) ? (value as Preset) : "all";
}

function calendarDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value : "";
}

function monthRange(today: string) {
  const [yearText, monthText] = today.split("-");
  const month = Number(monthText);
  const next = month === 12 ? `${Number(yearText) + 1}-01-01` : `${yearText}-${String(month + 1).padStart(2, "0")}-01`;
  return { start: dayRange(`${yearText}-${monthText}-01`).start, end: dayRange(next).start };
}

export default async function ParentAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; order?: string; student?: string }>;
}) {
  const user = await requireRole("PARENT", "parent");
  const params = await searchParams;
  const children = await linkedParentChildren(user.organizationId, user.id);
  const studentId = pickLinkedChildId(children, params.student);
  const order = params.order === "asc" ? "asc" : "desc";
  const from = calendarDate(params.from);
  const to = calendarDate(params.to);
  const custom = Boolean(from || to);
  const range = custom ? null : presetId(params.range);
  const today = shanghaiDateKey();
  const now = new Date();
  let window: { start?: Date; end?: Date } | null = null;
  let label = "全部课次";
  let invalid = false;
  if (from && to && from > to) {
    invalid = true;
    label = "开始日期晚于结束日期";
  } else if (custom) {
    window = {
      ...(from ? { start: dayRange(from).start } : {}),
      ...(to ? { end: dayRange(shiftDate(to, 1)).start } : {}),
    };
    label = `${from || "最早"} 至 ${to || "最晚"}`;
  } else if (range === "week") {
    const week = shanghaiWeekRange(now);
    window = week;
    label = "本周";
  } else if (range === "month") {
    window = monthRange(today);
    label = `${Number(today.slice(5, 7))}月`;
  } else if (range === "last7") {
    window = { start: dayRange(shiftDate(today, -6)).start, end: dayRange(shiftDate(today, 1)).start };
    label = "近 7 天";
  } else if (range === "upcoming") {
    window = { start: now };
    label = "以后的课";
  }

  const studentIds = studentId ? [studentId] : children.map((child) => child.id);
  const rows = !invalid && studentIds.length
    ? await prisma.lessonStudent.findMany({
        where: {
          organizationId: user.organizationId,
          studentId: { in: studentIds },
          ...parentVisibleLessonFilter(now),
          lessonSession: {
            status: { not: "CANCELLED" },
            ...(window?.start || window?.end
              ? { startAt: { ...(window.start ? { gte: window.start } : {}), ...(window.end ? { lt: window.end } : {}) } }
              : {}),
          },
        },
        include: {
          student: { select: { name: true, status: true } },
          lessonSession: { include: { course: { select: { name: true } }, teacher: { select: { name: true } } } },
        },
        orderBy: { lessonSession: { startAt: order } },
      })
    : [];
  const filtering = custom || (range !== null && range !== "all") || order === "asc" || Boolean(studentId);
  function listHref(next: { range?: string; from?: string; to?: string; order?: "asc" | "desc"; student?: string }) {
    const query = new URLSearchParams();
    const child = next.student ?? studentId;
    if (child) query.set("student", child);
    if (next.range && next.range !== "all") query.set("range", next.range);
    if (next.from) query.set("from", next.from);
    if (next.to) query.set("to", next.to);
    if (next.order === "asc") query.set("order", "asc");
    const text = query.toString();
    return text ? `/parent/attendance?${text}` : "/parent/attendance";
  }
  const sortHref = listHref({
    range: range ?? undefined,
    from,
    to,
    order: order === "asc" ? "desc" : "asc",
  });

  return (
    <section>
      <h1 className="text-[28px] font-semibold tracking-tight">出勤记录</h1>
      <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">这里只显示已绑定孩子在未取消课次里的出勤，最终状态以老师保存为准。家长请假后若老师改成出勤，这里会显示出勤，并保留家长请假备注。</p>
      <ParentChildFilter
        basePath="/parent/attendance"
        childrenList={children}
        selectedId={studentId}
        extraParams={{
          ...(range && range !== "all" ? { range } : {}),
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
          ...(order === "asc" ? { order: "asc" } : {}),
        }}
      />
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {presets.map((item) => {
          const active = !custom && range === item.id;
          return (
            <Link
              key={item.id}
              href={listHref({ range: item.id, order: order === "asc" ? "asc" : undefined })}
              className={`rounded-full px-3 py-1.5 text-xs font-bold ${active ? "bg-[var(--teal)] text-white" : "border border-[var(--line)] bg-white text-[#385058]"}`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
      <form action="/parent/attendance" className="mt-3 flex flex-wrap items-center gap-2">
        {studentId ? <input type="hidden" name="student" value={studentId} /> : null}
        <DateField name="from" defaultValue={from} className="w-36 rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold" />
        <span className="text-xs text-[var(--muted)]">至</span>
        <DateField name="to" defaultValue={to} className="w-36 rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold" />
        {order === "asc" ? <input type="hidden" name="order" value="asc" /> : null}
        <button className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">查看</button>
        {filtering ? <Link href="/parent/attendance" className="text-xs font-bold text-[var(--teal)]">重置</Link> : null}
      </form>
      <p className="mt-3 text-xs font-bold text-[#74838b]">当前正在查看：{label}{invalid ? "" : `，${rows.length} 条`}</p>
      <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        {rows.length === 0 ? (
          <p className="px-5 py-12 text-center leading-7 text-[var(--muted)]">{invalid ? "开始日期不能晚于结束日期。" : filtering ? "这个时间里没有出勤记录。" : "还没有出勤记录。"}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-xs">
              <thead className="bg-[#fafbf9] text-[10px] tracking-wide text-[#84918e]">
                <tr>
                  <th className="px-4 py-3 font-extrabold" aria-sort={order === "asc" ? "ascending" : "descending"}>
                    <Link href={sortHref} className="inline-flex items-center gap-1" title={order === "asc" ? "按日期从晚到早" : "按日期从早到晚"}>
                      日期
                      <span aria-hidden="true">{order === "asc" ? "↑" : "↓"}</span>
                    </Link>
                  </th>
                  <th className="px-4 py-3 font-extrabold">课次</th>
                  <th className="px-4 py-3 font-extrabold">孩子</th>
                  <th className="px-4 py-3 font-extrabold">教师</th>
                  <th className="px-4 py-3 font-extrabold">考勤状态</th>
                  <th className="px-4 py-3 font-extrabold">备注原因</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-[#eef1ee]">
                    <td className="px-4 py-4">{formatDateLabel(shanghaiDateKey(row.lessonSession.startAt))} {formatClock(row.lessonSession.startAt)}</td>
                    <td className="px-4 py-4 font-bold">{row.lessonSession.title ?? row.lessonSession.course.name}</td>
                    <td className="px-4 py-4">{row.student.name}{row.student.status === "INACTIVE" ? <span className="ml-1 text-[10px] font-bold text-[#9a6729]">已停用</span> : null}</td>
                    <td className="px-4 py-4">{row.lessonSession.teacher.name}</td>
                    <td className={`px-4 py-4 ${attendanceDisplayTone(row.attendanceStatus, row.leaveKind)}`}>{attendanceDisplayLabel(row.attendanceStatus, row.leaveKind)}</td>
                    <td className="max-w-[220px] whitespace-pre-wrap break-words px-4 py-4 text-[var(--muted)]">
                      {row.attendanceNote?.trim() || row.parentLeaveNote?.trim() || "无备注"}
                      {row.parentLeaveNote?.trim() && row.attendanceStatus !== "LEAVE" ? (
                        <span className="mt-1 block text-[10px] text-[#9a6729]">家长曾请假：{row.parentLeaveNote.trim()}（最终以老师点名为准）</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
