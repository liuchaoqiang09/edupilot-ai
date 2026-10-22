import Link from "next/link";
import type { AttendanceStatus, Prisma } from "@prisma/client";
import { SortHeader } from "@/components/sort-header";
import { requireRole } from "@/lib/auth";
import { dayRange, formatClock, formatDateLabel, shanghaiDateKey, shiftDate } from "@/lib/datetime";
import { attendanceLabel } from "@/lib/lesson-labels";
import { prisma } from "@/lib/prisma";
import { readSort } from "@/lib/table-sort";

const attendanceTone: Partial<Record<AttendanceStatus, string>> = {
  PRESENT: "font-bold text-[#34725d]",
  LEAVE: "font-bold text-[#c27b35]",
  ABSENT: "font-bold text-[#b94d4d]",
  LATE: "font-bold text-[#9a6729]",
};

function statusFromLabel(label: string | undefined) {
  const match = (Object.entries(attendanceLabel) as Array<[AttendanceStatus, string]>).find(([, text]) => text === label);
  return match?.[0] ?? null;
}

function listHref({ status, sortBy, order }: { status?: string | null; sortBy?: string | null; order?: string | null }) {
  const query = new URLSearchParams({ range: "last7days" });
  if (status) query.set("status", status);
  if (sortBy && order) {
    query.set("sortBy", sortBy);
    query.set("order", order);
  }
  return `/owner/attendance?${query}`;
}

export default async function OwnerAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; range?: string; sortBy?: string | string[]; order?: string | string[] }>;
}) {
  const user = await requireRole("OWNER", "owner");
  const params = await searchParams;
  const status = statusFromLabel(params.status);
  const sort = readSort(params.sortBy, params.order, ["date"] as const);
  const today = shanghaiDateKey();
  const start = dayRange(shiftDate(today, -6)).start;
  const end = dayRange(today).end;
  const orderBy: Prisma.LessonStudentOrderByWithRelationInput[] = [
    { lessonSession: { startAt: sort?.order ?? "desc" } },
    { student: { name: "asc" } },
  ];
  const rows = await prisma.lessonStudent.findMany({
    where: {
      organizationId: user.organizationId,
      ...(status ? { attendanceStatus: status } : {}),
      lessonSession: { startAt: { gte: start, lt: end }, status: { not: "CANCELLED" } },
    },
    select: {
      id: true,
      attendanceStatus: true,
      attendanceNote: true,
      student: { select: { name: true } },
      lessonSession: {
        select: {
          startAt: true,
          course: { select: { name: true } },
          teacher: { select: { name: true } },
        },
      },
    },
    orderBy,
  });
  const statusLabel = status ? attendanceLabel[status] : null;

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] font-semibold tracking-tight">出勤详情</h1>
        <Link href="/owner/stats" className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold text-[#385058]">← 返回基础统计</Link>
      </div>
      <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">这里列出近 7 天未取消课次里的考勤。范围与基础统计里的「近 7 天出勤」相同，状态由授课教师保存。</p>
      <p className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-[var(--teal-2)] px-2.5 py-1 font-bold text-[var(--teal)]">
          {statusLabel ? `当前正在查看：近 7 天${statusLabel}记录` : "当前正在查看：近 7 天出勤记录"}
        </span>
        {statusLabel ? <Link href={listHref({ sortBy: sort?.sortBy, order: sort?.order })} className="font-bold text-[var(--teal)]">重置</Link> : null}
      </p>
      <div className="mt-6 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        {rows.length === 0 ? (
          <p className="px-5 py-12 text-center leading-7 text-[var(--muted)]">{statusLabel ? `近 7 天没有${statusLabel}记录。` : "近 7 天没有考勤记录。"}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-xs">
              <thead className="bg-[#fafbf9] text-[10px] tracking-wide text-[#84918e]">
                <tr>
                  <SortHeader
                    label="日期"
                    field="date"
                    sortBy={sort?.sortBy ?? null}
                    order={sort?.order ?? null}
                    pathname="/owner/attendance"
                    extra={{ range: "last7days", ...(statusLabel ? { status: statusLabel } : {}) }}
                  />
                  <th className="px-4 py-3 font-extrabold">课程名称</th>
                  <th className="px-4 py-3 font-extrabold">教师</th>
                  <th className="px-4 py-3 font-extrabold">学生姓名</th>
                  <th className="px-4 py-3 font-extrabold">考勤状态</th>
                  <th className="px-4 py-3 font-extrabold">备注原因</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const dateKey = shanghaiDateKey(row.lessonSession.startAt);
                  return (
                    <tr key={row.id} className="border-t border-[#eef1ee]">
                      <td className="px-4 py-4">{formatDateLabel(dateKey)} {formatClock(row.lessonSession.startAt)}</td>
                      <td className="px-4 py-4 font-bold">{row.lessonSession.course.name}</td>
                      <td className="px-4 py-4">{row.lessonSession.teacher.name}</td>
                      <td className="px-4 py-4">{row.student.name}</td>
                      <td className={`px-4 py-4 ${attendanceTone[row.attendanceStatus] ?? ""}`}>{attendanceLabel[row.attendanceStatus]}</td>
                      <td className="px-4 py-4 text-[var(--muted)]">{row.attendanceNote?.trim() || "无备注"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
