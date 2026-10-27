import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { pick, publicLabel } from "@/lib/locale";
import { parentSnapshot } from "@/lib/dashboard";
import { formatYuan, parentCourseCards } from "@/lib/parent-courses";
import { formatClock, formatDateTime } from "@/lib/datetime";
import { attendanceLabel } from "@/lib/lesson-labels";
import { studentFacts, studyBadge } from "@/lib/student-profile";

export default async function ParentHomePage() {
  const user = await requireRole("PARENT", "parent");
  const [data, courses] = await Promise.all([
    parentSnapshot(user.organizationId, user.id),
    parentCourseCards(user.organizationId, user.id),
  ]);
  const coursePreview = courses.slice(0, 4);

  return (
    <section>
      <h1 className="text-[28px] font-semibold tracking-tight">{pick(user.locale, "孩子概览", "Overview")}</h1>
      <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">{pick(user.locale, "只显示已经绑定到这个账号的孩子，以及他们的近期课程、出勤和已发布报告。", "Only children linked to this account, with their upcoming lessons, attendance, and published reports.")}</p>

      <div className="mt-6 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        <div className="border-b border-[#eef1ee] px-4 py-3 text-sm font-semibold">已绑定孩子 · {data.links.length}</div>
        {data.links.length === 0 ? (
          <p className="px-4 py-12 text-center leading-7 text-[var(--muted)]">还没有绑定的孩子。请让机构负责人在学生档案里完成绑定。</p>
        ) : (
          <ul>
            {data.links.map((link) => (
              <li key={link.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-[#eef1ee] px-4 py-4 first:border-t-0">
                <div>
                  <div className="text-sm font-bold">{link.student.name}</div>
                  <div className="mt-1 text-xs text-[var(--muted)]">{studentFacts(link.student.grade, link.student.age, user.locale)} · {link.student.studentNo ?? pick(user.locale, "无编号", "No number")}</div>
                </div>
                <div className="text-right">
                  <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${studyBadge(link.student.status, link.student._count.enrollments > 0).className}`}>
                    {publicLabel(user.locale, studyBadge(link.student.status, link.student._count.enrollments > 0).label)}
                  </span>
                  {link.student.status === "INACTIVE" ? <div className="mt-1 text-xs text-[#74838b]">{pick(user.locale, "停用原因", "Reason")}：{link.student.archiveReason?.trim() || pick(user.locale, "未填写", "Not set")}</div> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {data.links.length === 0 ? null : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-[var(--line)] bg-white p-5 lg:col-span-2">
            <h2 className="text-sm font-semibold">课时与费用</h2>
            {coursePreview.length === 0 ? (
              <p className="mt-4 text-sm leading-7 text-[var(--muted)]">还没有报名或排课记录。</p>
            ) : (
              <ul className="mt-3">
                {coursePreview.map((card) => (
                  <li key={card.key} className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eef1ee] py-3 last:border-b-0">
                    <div>
                      <div className="text-sm font-bold">{card.studentName} · {card.courseName}</div>
                      <div className="mt-1 text-xs text-[var(--muted)]">{card.usage}</div>
                    </div>
                    {card.arrearsCents > 0 ? (
                      <span className="rounded-full bg-[#fff2df] px-2 py-1 text-[10px] font-bold text-[#9a6729]">待缴 {formatYuan(card.arrearsCents)} 元</span>
                    ) : card.enrolled ? (
                      <span className="rounded-full bg-[#edf5f1] px-2 py-1 text-[10px] font-bold text-[#34725d]">费用已结清</span>
                    ) : (
                      <span className="rounded-full bg-[#fff2df] px-2 py-1 text-[10px] font-bold text-[#9a6729]">还没有报名记录</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <Link href="/parent/courses" className="mt-3 inline-block text-xs font-bold text-[var(--teal)]">查看课时与费用</Link>
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
            <h2 className="text-sm font-semibold">从今天起 7 天的课程</h2>
            {data.upcoming.length === 0 ? (
              <p className="mt-4 text-sm leading-7 text-[var(--muted)]">从今天起 7 天内没有已安排的课次。</p>
            ) : (
              <ul className="mt-3">
                {data.upcoming.map((row) => (
                  <li key={row.id} className="border-b border-[#eef1ee] py-3 last:border-b-0">
                    <div className="text-sm font-bold">{row.lessonSession.course.name} · {row.student.name}</div>
                    <div className="mt-1 text-xs text-[var(--muted)]">{formatDateTime(row.lessonSession.startAt)}–{formatClock(row.lessonSession.endAt)} · {row.lessonSession.location ?? "未填地点"}</div>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/parent/schedule" className="mt-3 inline-block text-xs font-bold text-[var(--teal)]">查看课程安排</Link>
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
            <h2 className="text-sm font-semibold">最近已发布报告</h2>
            {data.reports.length === 0 ? (
              <p className="mt-4 text-sm leading-7 text-[var(--muted)]">还没有已发布的报告。教师确认发布后才会出现在这里。</p>
            ) : (
              <ul className="mt-3">
                {data.reports.map((report) => (
                  <li key={report.id} className="border-b border-[#eef1ee] py-3 last:border-b-0">
                    <div className="text-sm font-bold">{report.student.name} · {report.lessonSession.course.name}</div>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--muted)]">{report.summary || "报告已发布。"}</p>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/parent/reports" className="mt-3 inline-block text-xs font-bold text-[var(--teal)]">查看教学报告</Link>
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-white p-5 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">近 7 天出勤</h2>
              {data.attendance.rate == null ? null : (
                <span className="text-xs font-bold text-[#34725d]">
                  出勤率 {data.attendance.rate}%（(出勤+迟到)/已点名 {data.attendance.attended}/{data.attendance.due}）
                </span>
              )}
            </div>
            {data.attendance.total === 0 ? (
              <p className="mt-4 text-sm leading-7 text-[var(--muted)]">近 7 天还没有这些孩子的出勤记录。</p>
            ) : (
              <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {(Object.keys(attendanceLabel) as Array<keyof typeof attendanceLabel>).map((status) => (
                  <li key={status} className="flex items-center justify-between rounded-xl bg-[#f7faf8] px-3 py-2 text-xs">
                    <span>{attendanceLabel[status]}</span>
                    <strong>{data.attendance.counts[status]}</strong>
                  </li>
                ))}
              </ul>
            )}
            {data.attendance.counts.NOT_MARKED > 0 ? (
              <p className="mt-3 text-xs text-[var(--muted)]">「未标记」表示老师还没有保存这节课的考勤，不计入出勤率。</p>
            ) : null}
            <Link href="/parent/attendance" className="mt-3 inline-block text-xs font-bold text-[var(--teal)]">查看出勤记录</Link>
          </div>
        </div>
      )}
    </section>
  );
}
