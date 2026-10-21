import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { dayRange, formatClock, formatDateLabel, parseDateKey, shiftDate } from "@/lib/datetime";
import { attendanceLabel, lessonStatusLabel } from "@/lib/lesson-labels";
import { prisma } from "@/lib/prisma";

export default async function ParentSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const user = await requireRole("PARENT", "parent");
  const params = await searchParams;
  const date = parseDateKey(params.date);
  const range = dayRange(date);
  const links = await prisma.parentStudentLink.findMany({
    where: { organizationId: user.organizationId, parentUserId: user.id },
    select: { studentId: true },
  });
  const rows = links.length
    ? await prisma.lessonStudent.findMany({
        where: {
          organizationId: user.organizationId,
          studentId: { in: links.map((link) => link.studentId) },
          lessonSession: { startAt: { gte: range.start, lt: range.end } },
        },
        include: {
          student: { select: { name: true } },
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

  return (
    <section>
      <h1 className="text-[28px] font-semibold tracking-tight">课程安排</h1>
      <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">只显示已经绑定到你账号上的孩子，以及他们被加入的课次。</p>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Link href={`/parent/schedule?date=${shiftDate(date, -1)}`} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">前一天</Link>
        <form action="/parent/schedule" className="flex items-center gap-2">
          <input type="date" name="date" defaultValue={date} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold" />
          <button className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">查看</button>
        </form>
        <Link href={`/parent/schedule?date=${shiftDate(date, 1)}`} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">后一天</Link>
        <span className="text-xs text-[var(--muted)]">{formatDateLabel(date)}</span>
      </div>
      <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        {rows.length === 0 ? (
          <p className="px-5 py-12 text-center leading-7 text-[var(--muted)]">这一天没有已绑定孩子的课次。</p>
        ) : (
          <ul className="px-5">
            {rows.map((row) => (
              <li key={row.id} className="grid grid-cols-[64px_4px_minmax(0,1fr)_auto] items-center gap-3 border-b border-[#f0f2f0] py-4 last:border-b-0">
                <div className="text-xs font-extrabold">
                  {formatClock(row.lessonSession.startAt)}
                  <small className="mt-1 block font-medium text-[var(--muted)]">{formatClock(row.lessonSession.endAt)}</small>
                </div>
                <div className="h-10 w-1 rounded bg-[#91c8b5]" />
                <div>
                  <div className="text-xs font-bold">{row.lessonSession.title ?? `${row.lessonSession.course.name} · ${row.lessonSession.classGroup.name}`}</div>
                  <div className="mt-1 text-[11px] text-[var(--muted)]">{row.student.name} · {row.lessonSession.teacher.name} · {row.lessonSession.location ?? "地点待定"}</div>
                </div>
                <span className="rounded-full bg-[#edf5f1] px-2 py-1 text-[10px] font-bold text-[#34725d]">
                  {row.lessonSession.status === "CANCELLED" ? lessonStatusLabel.CANCELLED : attendanceLabel[row.attendanceStatus]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
