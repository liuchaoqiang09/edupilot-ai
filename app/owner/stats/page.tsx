import { requireRole } from "@/lib/auth";
import { ownerSnapshot } from "@/lib/dashboard";
import { attendanceLabel } from "@/lib/lesson-labels";

export default async function OwnerStatsPage() {
  const user = await requireRole("OWNER", "owner");
  const data = await ownerSnapshot(user.organizationId);
  const rows = [
    ["在读学生", data.activeStudents],
    ["已停用学生", data.inactiveStudents],
    ["在职教师", data.activeTeachers],
    ["今日课次", data.todayLessons],
    ["今天起 7 天课次", data.upcomingLessons],
    ["待填写教学记录", data.pendingRecords],
    ["待确认报告", data.pendingReports],
  ] as const;

  return (
    <section>
      <h1 className="text-[28px] font-semibold tracking-tight">基础统计</h1>
      <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">每一项都是当前机构的实时计数。没有记录时是 0，不是示例数字。</p>
      <div className="mt-6 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        <ul>
          {rows.map(([label, value]) => (
            <li key={label} className="flex items-center justify-between gap-3 border-b border-[#eef1ee] px-4 py-4 last:border-b-0">
              <span className="text-sm">{label}</span>
              <strong className="text-lg">{value}</strong>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-4 rounded-2xl border border-[var(--line)] bg-white p-5">
        <h2 className="text-sm font-semibold">近 7 天出勤</h2>
        {data.attendance.total === 0 ? (
          <p className="mt-4 text-sm leading-7 text-[var(--muted)]">近 7 天没有可统计的课次名单。</p>
        ) : (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {(Object.keys(attendanceLabel) as Array<keyof typeof attendanceLabel>).map((status) => (
              <li key={status} className="flex items-center justify-between rounded-xl bg-[#f7faf8] px-3 py-2 text-xs">
                <span>{attendanceLabel[status]}</span>
                <strong>{data.attendance.counts[status]}</strong>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
