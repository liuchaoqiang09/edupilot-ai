import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { pick } from "@/lib/locale";
import { ownerSnapshot } from "@/lib/dashboard";
import { shanghaiDateKey } from "@/lib/datetime";
import { attendanceLabel } from "@/lib/lesson-labels";

export default async function OwnerStatsPage() {
  const user = await requireRole("OWNER", "owner");
  const data = await ownerSnapshot(user.organizationId);
  const today = shanghaiDateKey();
  const t = (zh: string, en: string) => pick(user.locale, zh, en);
  const rows = [
    { label: t("在读学生", "Active students"), value: data.activeStudents, href: "/owner/students?status=在读" },
    { label: t("已停用学生", "Inactive students"), value: data.inactiveStudents, href: "/owner/students?status=已停用" },
    { label: t("在职教师", "Active teachers"), value: data.activeTeachers, href: "/owner/teachers?status=在职" },
    { label: t("今日课次", "Lessons today"), value: data.todayLessons, href: `/owner/schedule?view=day&date=${today}` },
    { label: t("今天起 7 天课次", "Next 7 days"), value: data.upcomingLessons, href: "/owner/schedule?range=next7days" },
    { label: t("待填写教学记录", "Notes to write"), value: data.pendingRecords, href: "/owner/schedule?status=待填写" },
    { label: t("待确认报告", "Reports to review"), value: data.pendingReports, href: "/owner/reports?status=待确认" },
  ];

  return (
    <section>
      <h1 className="text-[28px] font-semibold tracking-tight">{t("基础统计", "Statistics")}</h1>
      <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">{t("每一项都是当前机构的实时计数。没有记录时是 0，不是示例数字。", "Each number is a live count for this organization. Zero means there is no record.")}</p>
      <div className="mt-6 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        <ul>
          {rows.map((row) => (
            <li key={row.label} className="border-b border-[#eef1ee] last:border-b-0">
              <Link href={row.href} className="flex cursor-pointer items-center justify-between gap-3 px-4 py-4 transition hover:bg-[#f4faf7]">
                <span className="text-sm">{row.label}</span>
                <strong className="text-lg">{row.value}</strong>
              </Link>
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
              <li key={status}>
                <Link href={`/owner/attendance?status=${attendanceLabel[status]}&range=last7days`} className="flex cursor-pointer items-center justify-between rounded-xl bg-[#f7faf8] px-3 py-2 text-xs transition hover:bg-[#e7f3ee]">
                  <span>{attendanceLabel[status]}</span>
                  <strong>{data.attendance.counts[status]}</strong>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
