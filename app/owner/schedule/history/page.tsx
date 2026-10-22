import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { attendanceLabel, lessonStatusLabel } from "@/lib/lesson-labels";
import { dayRange, formatClock, formatDateLabel, shanghaiDateKey, shiftDate } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";

const pageSize = 20;

export default async function ScheduleHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; teacherId?: string; classGroupId?: string; page?: string }>;
}) {
  const user = await requireRole("OWNER", "owner");
  const params = await searchParams;
  const today = shanghaiDateKey();
  const earliest = shiftDate(today, -365);
  const requestedFrom = params.from && /^\d{4}-\d{2}-\d{2}$/.test(params.from) ? params.from : earliest;
  const requestedTo = params.to && /^\d{4}-\d{2}-\d{2}$/.test(params.to) ? params.to : today;
  const from = requestedFrom < earliest ? earliest : requestedFrom;
  const to = requestedTo > today ? today : requestedTo;
  const page = Math.max(1, Number(params.page) || 1);
  const clamped = requestedFrom < earliest || requestedTo > today;

  const [teachers, classes] = await Promise.all([
    prisma.teacher.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.classGroup.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const teacherId = teachers.some((teacher) => teacher.id === params.teacherId) ? params.teacherId : "";
  const classGroupId = classes.some((item) => item.id === params.classGroupId) ? params.classGroupId : "";
  const where = {
    organizationId: user.organizationId,
    startAt: { gte: dayRange(from).start, lt: dayRange(shiftDate(to, 1)).start },
    ...(teacherId ? { teacherId } : {}),
    ...(classGroupId ? { classGroupId } : {}),
  };
  const [total, lessons] = from > to
    ? [0, []]
    : await Promise.all([
        prisma.lessonSession.count({ where }),
        prisma.lessonSession.findMany({
          where,
          orderBy: { startAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            title: true,
            startAt: true,
            endAt: true,
            location: true,
            status: true,
            course: { select: { name: true } },
            classGroup: { select: { name: true } },
            teacher: { select: { name: true } },
            students: {
              orderBy: { student: { name: "asc" } },
              select: { attendanceStatus: true, attendanceNote: true, student: { select: { name: true } } },
            },
          },
        }),
      ]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const query = new URLSearchParams({ from, to });
  if (teacherId) query.set("teacherId", teacherId);
  if (classGroupId) query.set("classGroupId", classGroupId);

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">历史课表</h1>
          <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">只读。可以按日期、教师和班级查询本机构最近一年的课次和考勤。超过一年的课次会先导出到冷备文件，再从数据库清理，页面不再显示。</p>
        </div>
        <Link href="/owner/schedule" className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold">返回课表</Link>
      </div>
      {clamped ? <p className="mt-4 rounded-xl bg-[#fff2df] px-4 py-3 text-xs leading-6 text-[#9a6729]">查询范围已限制在最近一年到今天。更早的课次不在这个页面。</p> : null}

      <form action="/owner/schedule/history" className="mt-6 grid gap-3 rounded-2xl border border-[var(--line)] bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
        <label className="grid gap-1.5 text-xs font-bold">开始日期<input type="date" name="from" defaultValue={from} className="rounded-[10px] border border-[var(--line)] px-3 py-2 text-sm font-medium" /></label>
        <label className="grid gap-1.5 text-xs font-bold">结束日期<input type="date" name="to" defaultValue={to} className="rounded-[10px] border border-[var(--line)] px-3 py-2 text-sm font-medium" /></label>
        <label className="grid gap-1.5 text-xs font-bold">教师
          <select name="teacherId" defaultValue={teacherId} className="rounded-[10px] border border-[var(--line)] px-3 py-2 text-sm font-medium">
            <option value="">全部教师</option>
            {teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-xs font-bold">班级
          <select name="classGroupId" defaultValue={classGroupId} className="rounded-[10px] border border-[var(--line)] px-3 py-2 text-sm font-medium">
            <option value="">全部班级</option>
            {classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <div className="flex items-end">
          <button className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white">查询</button>
        </div>
      </form>

      <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        {lessons.length === 0 ? (
          <p className="px-5 py-12 text-center leading-7 text-[var(--muted)]">{from > to ? "开始日期晚于结束日期。" : "这个范围里没有课次。"}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-xs">
              <thead className="bg-[#fafbf9] text-[10px] tracking-wide text-[#84918e]">
                <tr>
                  <th className="px-4 py-3 font-extrabold">时间</th>
                  <th className="px-4 py-3 font-extrabold">课程 / 班级</th>
                  <th className="px-4 py-3 font-extrabold">教师 / 地点</th>
                  <th className="px-4 py-3 font-extrabold">状态</th>
                  <th className="px-4 py-3 font-extrabold">考勤</th>
                </tr>
              </thead>
              <tbody>
                {lessons.map((lesson) => (
                  <tr key={lesson.id} className="border-t border-[#f0f2f0] align-top">
                    <td className="px-4 py-3 font-bold">{formatDateLabel(shanghaiDateKey(lesson.startAt))}<div className="mt-1 font-medium text-[var(--muted)]">{formatClock(lesson.startAt)}–{formatClock(lesson.endAt)}</div></td>
                    <td className="px-4 py-3">{lesson.course.name}<div className="mt-1 text-[var(--muted)]">{lesson.classGroup.name}</div></td>
                    <td className="px-4 py-3">{lesson.teacher.name}<div className="mt-1 text-[var(--muted)]">{lesson.location ?? "地点待定"}</div></td>
                    <td className="px-4 py-3">{lessonStatusLabel[lesson.status]}</td>
                    <td className="px-4 py-3 leading-6 text-[var(--muted)]">
                      {lesson.students.length === 0 ? "没有学生" : lesson.students.map((row) => `${row.student.name} ${attendanceLabel[row.attendanceStatus]}${row.attendanceNote ? `（${row.attendanceNote}）` : ""}`).join("、")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="mt-4 flex items-center justify-between text-xs">
        <span className="text-[var(--muted)]">共 {total} 节 · 第 {Math.min(page, pages)} / {pages} 页</span>
        <div className="flex gap-2">
          {page > 1 ? <Link href={`/owner/schedule/history?${query}&page=${page - 1}`} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 font-bold">上一页</Link> : null}
          {page < pages ? <Link href={`/owner/schedule/history?${query}&page=${page + 1}`} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 font-bold">下一页</Link> : null}
        </div>
      </div>
    </section>
  );
}
