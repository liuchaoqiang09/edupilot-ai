import Link from "next/link";
import { DateField } from "@/components/date-field";
import { ParentChildFilter } from "@/components/parent-child-filter";
import { ParentLeaveCancel, ParentLeaveRequest } from "@/components/parent-leave-actions";
import { requireRole } from "@/lib/auth";
import { dayRange, formatClock, formatDateLabel, formatDateTime, parseDateKey, shanghaiDateKey, shanghaiWeekRange, shiftDate } from "@/lib/datetime";
import { attendanceDisplayLabel } from "@/lib/leave-kind";
import { attendanceLabel, lessonStatusLabel } from "@/lib/lesson-labels";
import { makeupLabel } from "@/lib/lesson-seat";
import { linkedParentChildren, parentVisibleLessonFilter, pickLinkedChildId } from "@/lib/parent-scope";
import { prisma } from "@/lib/prisma";
import type { LeaveKind } from "@prisma/client";

type ScheduleRow = {
  id: string;
  parentLeaveAt: Date | null;
  attendanceStatus: keyof typeof attendanceLabel;
  leaveKind: LeaveKind | null;
  hoursCharged: boolean;
  makeups: { lessonSession: { startAt: Date } }[];
  makeupSource: { lessonSession: { startAt: Date } } | null;
  student: { name: string; status: string };
  lessonSession: {
    title: string | null;
    startAt: Date;
    endAt: Date;
    status: string;
    location: string | null;
    course: { name: string };
    teacher: { name: string };
    classGroup: { name: string };
  };
};

export default async function ParentSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string; student?: string }>;
}) {
  const user = await requireRole("PARENT", "parent");
  const params = await searchParams;
  const view = params.view === "week" ? "week" : "day";
  const date = parseDateKey(params.date);
  const week = shanghaiWeekRange(new Date(`${date}T12:00:00+08:00`));
  const weekStart = shanghaiDateKey(week.start);
  const range = view === "week" ? week : dayRange(date);
  const children = await linkedParentChildren(user.organizationId, user.id);
  const studentId = pickLinkedChildId(children, params.student);
  const studentIds = studentId ? [studentId] : children.map((child) => child.id);
  const rows = studentIds.length
    ? await prisma.lessonStudent.findMany({
        where: {
          organizationId: user.organizationId,
          studentId: { in: studentIds },
          ...parentVisibleLessonFilter(),
          lessonSession: { startAt: { gte: range.start, lt: range.end } },
        },
        include: {
          student: { select: { name: true, status: true } },
          makeups: { select: { lessonSession: { select: { startAt: true } } }, take: 1 },
          makeupSource: { select: { lessonSession: { select: { startAt: true } } } },
          lessonSession: {
            include: {
              course: { select: { name: true } },
              teacher: { select: { name: true } },
              classGroup: { select: { name: true } },
            },
          },
        },
        orderBy: { lessonSession: { startAt: "asc" } },
      })
    : [];
  const now = Date.now();
  const visibleRows = rows;
  const days = Array.from({ length: 7 }, (_, index) => shiftDate(weekStart, index));
  const studentQuery = studentId ? `&student=${studentId}` : "";

  return (
    <section>
      <h1 className="text-[28px] font-semibold tracking-tight">课程安排</h1>
      <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">只显示已经绑定到你账号上的孩子，以及他们被加入的课次。已停用孩子只显示已经上过的课。请假提交后，老师点名仍可改成出勤；最终以老师保存的考勤为准。</p>
      <ParentChildFilter
        basePath="/parent/schedule"
        childrenList={children}
        selectedId={studentId}
        extraParams={{ view, date: view === "week" ? weekStart : date }}
      />
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-[10px] border border-[var(--line)] bg-white p-1">
          <Link href={`/parent/schedule?view=day&date=${date}${studentQuery}`} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${view === "day" ? "bg-[var(--teal)] text-white" : "text-[#385058]"}`}>单日列表</Link>
          <Link href={`/parent/schedule?view=week&date=${date}${studentQuery}`} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${view === "week" ? "bg-[var(--teal)] text-white" : "text-[#385058]"}`}>周视图</Link>
        </div>
        {view === "day" ? (
          <>
            <Link href={`/parent/schedule?view=day&date=${shiftDate(date, -1)}${studentQuery}`} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">前一天</Link>
            <form action="/parent/schedule" className="flex items-center gap-2">
              <input type="hidden" name="view" value="day" />
              {studentId ? <input type="hidden" name="student" value={studentId} /> : null}
              <DateField name="date" defaultValue={date} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold" />
              <button className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">查看</button>
            </form>
            <Link href={`/parent/schedule?view=day&date=${shiftDate(date, 1)}${studentQuery}`} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">后一天</Link>
            <span className="text-xs text-[var(--muted)]">{formatDateLabel(date)}</span>
          </>
        ) : (
          <>
            <Link href={`/parent/schedule?view=week&date=${shiftDate(weekStart, -7)}${studentQuery}`} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">上一周</Link>
            <form action="/parent/schedule" className="flex items-center gap-2">
              <input type="hidden" name="view" value="week" />
              {studentId ? <input type="hidden" name="student" value={studentId} /> : null}
              <DateField name="date" defaultValue={date} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold" />
              <button className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">查看</button>
            </form>
            <Link href={`/parent/schedule?view=week&date=${shiftDate(weekStart, 7)}${studentQuery}`} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">下一周</Link>
            <span className="text-xs text-[var(--muted)]">{formatDateLabel(weekStart)} – {formatDateLabel(shiftDate(weekStart, 6))}</span>
          </>
        )}
      </div>
      {view === "day" ? (
        <DayList rows={visibleRows.filter((row) => shanghaiDateKey(row.lessonSession.startAt) === date)} now={now} empty="这一天没有已绑定孩子的课次。" />
      ) : (
        <div className="mt-4 grid gap-3">
          {days.map((day) => (
            <section key={day} className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
              <div className="flex items-center justify-between gap-3 border-b border-[#eef1ee] px-5 py-3">
                <h2 className="text-sm font-semibold">{formatDateLabel(day)}</h2>
                <Link href={`/parent/schedule?view=day&date=${day}${studentQuery}`} className="text-xs font-bold text-[var(--teal)]">看这一天</Link>
              </div>
              <DayList rows={visibleRows.filter((row) => shanghaiDateKey(row.lessonSession.startAt) === day)} now={now} empty="这一天没有课。" plain />
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function DayList({ rows, now, empty, plain = false }: { rows: ScheduleRow[]; now: number; empty: string; plain?: boolean }) {
  if (rows.length === 0) {
    return <p className={plain ? "px-5 py-6 text-sm text-[var(--muted)]" : "mt-4 rounded-2xl border border-[var(--line)] bg-white px-5 py-12 text-center leading-7 text-[var(--muted)]"}>{empty}</p>;
  }
  return (
    <ul className={plain ? "px-5" : "mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-white px-5"}>
      {rows.map((row) => (
        <li key={row.id} className="grid grid-cols-[64px_4px_minmax(0,1fr)] items-start gap-3 border-b border-[#f0f2f0] py-4 last:border-b-0 sm:grid-cols-[64px_4px_minmax(0,1fr)_auto] sm:items-center">
          <div className="text-xs font-extrabold">
            {formatClock(row.lessonSession.startAt)}
            <small className="mt-1 block font-medium text-[var(--muted)]">{formatClock(row.lessonSession.endAt)}</small>
          </div>
          <div className="h-10 w-1 rounded bg-[#91c8b5]" />
          <div>
            <div className="text-xs font-bold">{row.lessonSession.title ?? `${row.lessonSession.course.name} · ${row.lessonSession.classGroup.name}`}</div>
            <div className="mt-1 text-[11px] text-[var(--muted)]">
              {row.student.name}
              {row.student.status === "INACTIVE" ? <span className="ml-1 font-bold text-[#9a6729]">已停用</span> : null}
              {" · "}{row.lessonSession.teacher.name} · {row.lessonSession.location ?? "地点待定"}
            </div>
            {row.makeupSource ? <div className="mt-1 text-[11px] font-bold text-[#9a6729]">{makeupLabel(row.makeupSource.lessonSession.startAt)}</div> : null}
            {row.makeups[0] ? <div className="mt-1 text-[11px] font-bold text-[#9a6729]">补课已安排在 {formatDateTime(row.makeups[0].lessonSession.startAt)}</div> : null}
          </div>
          <div className="col-span-3 text-left sm:col-span-1 sm:text-right">
            <span className="rounded-full bg-[#edf5f1] px-2 py-1 text-[10px] font-bold text-[#34725d]">
              {row.lessonSession.status === "CANCELLED"
                ? lessonStatusLabel.CANCELLED
                : row.parentLeaveAt
                  ? "已请假（事假）"
                  : attendanceDisplayLabel(row.attendanceStatus, row.leaveKind)}
            </span>
            {row.student.status === "INACTIVE" ? (
              <p className="mt-2 text-[11px] text-[#74838b]">孩子已停用，只能查看历史，不能请假。</p>
            ) : row.lessonSession.status !== "CANCELLED" && row.lessonSession.startAt.getTime() > now && !row.hoursCharged && row.makeups.length === 0 ? (
              row.parentLeaveAt ? (
                <ParentLeaveCancel lessonStudentId={row.id} />
              ) : row.attendanceStatus === "LEAVE" ? (
                <p className="mt-2 text-[11px] text-[var(--muted)]">老师已记下请假</p>
              ) : (
                <ParentLeaveRequest lessonStudentId={row.id} />
              )
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
