import Link from "next/link";
import { OwnerTodayLessons, type TodayLessonCard } from "@/components/owner-today-lessons";
import { RevenueTrend } from "@/components/revenue-trend";
import { requireRole } from "@/lib/auth";
import { pick, type Locale } from "@/lib/locale";
import { ownerOverview } from "@/lib/dashboard";
import { lessonTodoHref, ownerTodoLists, renewalTodoHref, reportTodoHref, waitlistTodoHref } from "@/lib/todo-center";
import { formatClock, formatDateLabel, shanghaiDateKey } from "@/lib/datetime";

function changeText(current: number, previous: number) {
  if (previous === 0) return current === 0 ? "上月也是 0" : "上月为 0";
  const value = Math.round(((current - previous) / previous) * 1000) / 10;
  return `${value > 0 ? "+" : ""}${value}% 较上月`;
}

function hello(name: string, locale: Locale) {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", hour: "numeric", hourCycle: "h23" }).format(new Date()),
  );
  const zh = hour < 12 ? "早上好" : hour < 18 ? "下午好" : "晚上好";
  const en = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return pick(locale, `${zh}，${name}`, `${en}, ${name}`);
}

export default async function OwnerHomePage() {
  const user = await requireRole("OWNER", "owner");
  const t = (zh: string, en: string) => pick(user.locale, zh, en);
  const [data, todos] = await Promise.all([ownerOverview(user.organizationId), ownerTodoLists(user.organizationId)]);
  const unfollowedRenewals = new Set(todos.renewals.map((row) => row.key.split(":")[0])).size;
  const renewalHref = todos.renewals.length === 1 ? renewalTodoHref(todos.renewals[0].key) : "/owner/todos?group=renewal";
  const reportHref = todos.reports.length === 1 ? reportTodoHref(todos.reports[0].id) : "/owner/todos?group=reports";
  const recordHref = todos.records.length === 1 ? lessonTodoHref(todos.records[0].id, shanghaiDateKey(todos.records[0].startAt)) : "/owner/todos?group=records";
  const trialHref = todos.trials.length === 1 ? lessonTodoHref(todos.trials[0].lessonSession.id, shanghaiDateKey(todos.trials[0].lessonSession.startAt)) : "/owner/todos?group=trials";
  const waitlistHref = todos.fullQueues.length === 1 ? waitlistTodoHref(todos.fullQueues[0].id) : "/owner/todos?group=waitlist";
  const now = new Date();
  const todayLessons: TodayLessonCard[] = data.lessons.map((lesson) => ({
    id: lesson.id,
    title: lesson.title ?? "课次",
    startLabel: formatClock(lesson.startAt),
    endLabel: formatClock(lesson.endAt),
    location: lesson.location,
    courseName: lesson.course.name,
    teacherName: lesson.teacher.name,
    recorded: Boolean(lesson.teachingRecord),
    started: lesson.startAt <= now,
    ended: lesson.endAt <= now,
    students: lesson.students.map((row) => ({
      id: row.id,
      name: row.student.name,
      attendanceStatus: row.attendanceStatus,
      attendanceNote: row.attendanceNote,
    })),
  }));
  const todaySchedule = `/owner/schedule?view=day&date=${shanghaiDateKey()}`;
  const maxWeek = Math.max(...data.weeks.map((week) => week.count), 0);
  const openItems = (data.pendingReports > 0 ? 1 : 0) + (data.missingRecords > 0 ? 1 : 0) + (unfollowedRenewals > 0 ? 1 : 0) + (data.trialCount > 0 ? 1 : 0) + (todos.fullQueues.length > 0 ? 1 : 0);
  const names = data.pendingNames;
  const reportHint =
    names.length === 0
      ? "目前没有等待处理的报告。"
      : names.length <= 2
        ? `${names.join("、")}的课后反馈等待处理。`
        : `${names.slice(0, 2).join("、")}等学员的课后反馈等待处理。`;

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">{hello(user.name, user.locale)}</h1>
          <p className="mt-2 text-sm leading-7 text-[var(--muted)]">{t(`这是${user.organizationName}今天的教学与经营概况。数字只来自当前机构的数据库。`, `Today at ${user.organizationName}. These numbers come from this organization.`)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/owner/schedule" className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold">{t("▣ 查看课表", "Schedule")}</Link>
          <Link href="/owner/students?create=1" className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white">{t("＋ 新增学员", "+ Add student")}</Link>
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard href="/owner/students?status=在读" icon="♙" label={t("在读学员", "Active students")} value={data.activeStudents} foot={data.newStudents > 0 ? t(`本月新增 ${data.newStudents}`, `${data.newStudents} new this month`) : t("本月还没有新增学员", "No new students this month")} up={data.newStudents > 0} />
        <StatCard href={todaySchedule} icon="▦" label={t("今日课程", "Today")} value={data.lessons.length} foot={t(`已排课 ${data.lessons.length} 节 · ${data.missingRecords} 节待记录`, `${data.lessons.length} scheduled · ${data.missingRecords} notes missing`)} />
        <StatCard href={renewalHref} icon="¥" label={t("待续费学员", "Renewals")} value={unfollowedRenewals} foot={unfollowedRenewals === 0 ? t(data.renewingCount > 0 ? "需要续费的学员都已经有跟进记录" : "没有还没跟进的续费", "No renewal is waiting for a first note") : t("待续费，且还没有跟进记录", "Needs renewal and has no follow-up yet")} />
        <StatCard href={reportHref} icon="✳" label={t("待确认报告", "Reports to review")} value={data.pendingReports} foot={data.pendingReports === 0 ? t("目前没有等待确认的报告", "No reports waiting") : t("草稿、已确认或已退回，家长还看不到", "Draft, confirmed, or returned. Parents cannot see them yet.")} />
      </div>

      <div className="mt-4 grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.8fr)]">
        <div className="grid gap-4">
        <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-[#edf0ee] px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold">今日课程安排</h2>
              <p className="mt-1 text-[11px] text-[var(--muted)]">{formatDateLabel(data.todayKey)}</p>
            </div>
            <Link href="/owner/schedule" className="text-xs font-bold text-[var(--teal)]">查看全部 →</Link>
          </div>
          {data.lessons.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm leading-7 text-[var(--muted)]">今天还没有课次。可以先去排课，安排今天的课程。</p>
          ) : (
            <OwnerTodayLessons lessons={todayLessons} />
          )}
        </section>
        <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-[#edf0ee] px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold">教学反馈完成率</h2>
              <p className="mt-1 text-[11px] text-[var(--muted)]">按今天的课次和学生名单计算。没有课次时是 0%。</p>
            </div>
            <span className="rounded-full bg-[var(--teal-2)] px-2 py-1 text-[10px] font-bold text-[var(--teal)]">今天</span>
          </div>
          <Progress label="课堂记录已提交" value={data.rates.recorded} hint={data.lessons.length === 0 ? "今天没有课次" : data.rates.lessonCount === 0 ? "还没有已结束的课次" : `${data.rates.lessonCount} 节已结束的课`} />
          <Progress label="AI 分析已生成" value={data.rates.generated} hint={data.lessons.length === 0 ? "今天没有课次" : data.rates.lessonCount === 0 ? "还没有已结束的课次" : data.rates.expectedReports === 0 ? "已结束的课次还没有学员" : `${data.rates.expectedReports} 位学员`} />
          <Progress label="报告已发布" value={data.rates.published} hint={data.lessons.length === 0 ? "今天没有课次" : data.rates.lessonCount === 0 ? "还没有已结束的课次" : data.rates.expectedReports === 0 ? "已结束的课次还没有学员" : `${data.rates.expectedReports} 位学员`} />
        </section>
        </div>

        <div className="flex flex-col gap-4 xl:h-full xl:min-h-0">
        <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-[#edf0ee] px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold">需要你处理</h2>
              <p className="mt-1 text-[11px] text-[var(--muted)]">优先处理影响教学流程的事项</p>
            </div>
            <span className="rounded-full bg-[#fff2df] px-2 py-1 text-[10px] font-bold text-[#9a6729]">{openItems} 项</span>
          </div>
          <ul className="px-5">
            <Todo icon="✳" title="AI 教学报告待确认" body={reportHint} count={data.pendingReports} href={reportHref} action={todos.reports.length === 1 ? "打开这份报告 →" : "去查看 →"} />
            <Todo icon="¥" title="学员续费跟进" body={unfollowedRenewals === 0 ? (data.renewingCount > 0 ? "需要续费的学员都已经有跟进记录。" : "目前没有还没跟进的续费。") : `有 ${unfollowedRenewals} 位学员待续费，而且这门课还没有跟进记录。`} count={unfollowedRenewals} href={renewalHref} action={todos.renewals.length === 1 ? "打开这条跟进 →" : "去跟进 →"} green />
            <Todo icon="▣" title="教学记录完成情况" body={data.lessons.length === 0 ? "今天没有需要填写的课次。" : data.missingRecords > 0 ? `今天已结束的课次里，仍有 ${data.missingRecords} 节未提交课堂记录。` : data.lessons.some((lesson) => !lesson.teachingRecord) ? "还没结束的课次，结束后再填写记录。" : "今天已结束的课次都已经有课堂记录。"} count={data.missingRecords} href={recordHref} action={todos.records.length === 1 ? "打开这节课 →" : "查看进度 →"} />
            <Todo icon="听" title="未转正的试听" body={data.trialCount === 0 ? "目前没有还没转为报名的试听。" : `有 ${data.trialCount} 条试听还没有转为报名。`} count={data.trialCount} href={trialHref} action={todos.trials.length === 1 ? "打开这节试听 →" : "去课表 →"} />
            <Todo icon="班" title="满班排队" body={todos.fullQueues.length === 0 ? "没有又满、又有人排队的班级。" : `有 ${todos.fullQueues.length} 个班已经满员，并且还有学生在排队。`} count={todos.fullQueues.length} href={waitlistHref} action={todos.fullQueues.length === 1 ? "打开排队 →" : "去处理 →"} />
          </ul>
        </section>
        <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-[#edf0ee] px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold">本月报名概况</h2>
              <p className="mt-1 text-[11px] text-[var(--muted)]">按本月保存的报名记录分周统计。没有报名时为 0。</p>
            </div>
            <span className="text-xs font-bold text-[var(--teal)]">{changeText(data.enrollmentsThisMonth, data.enrollmentsLastMonth)}</span>
          </div>
          <div className="px-5 pb-8 pt-5">
            <div className="flex h-28 items-end gap-3 border-b border-[var(--line)]">
              {data.weeks.map((week, index) => (
                <div key={week.label} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
                  <span className="text-[10px] font-bold text-[var(--muted)]">{week.count}</span>
                  <i
                    className={`block w-full max-w-8 rounded-t-md ${index === data.currentWeek ? "bg-[var(--teal)]" : "bg-[#cfe6dd]"}`}
                    style={{ height: maxWeek === 0 ? 0 : `${Math.max((week.count / maxWeek) * 100, week.count > 0 ? 8 : 0)}%` }}
                  />
                  <small className="translate-y-6 text-[10px] text-[var(--muted)]">{week.label}</small>
                </div>
              ))}
            </div>
            {data.enrollmentsThisMonth === 0 ? <p className="mt-8 text-center text-xs leading-6 text-[var(--muted)]">本月还没有报名记录，柱子保持为 0。</p> : null}
          </div>
        </section>
        <section className="flex min-h-52 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-white xl:min-h-0">
          <div className="border-b border-[#edf0ee] px-5 py-4">
            <h2 className="text-sm font-semibold">近 6 个月收入趋势</h2>
            <p className="mt-1 text-[11px] text-[var(--muted)]">按报名记录的实收时间，汇总每个月的实收金额。</p>
          </div>
          <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
            <RevenueTrend points={data.revenue} />
          </div>
        </section>
        </div>
      </div>
    </section>
  );
}

function StatCard({ href, icon, label, value, foot, up = false }: { href: string; icon: string; label: string; value: number; foot: string; up?: boolean }) {
  return (
    <Link href={href} className="block cursor-pointer rounded-2xl border border-[var(--line)] bg-white p-5 transition hover:shadow-[0_8px_24px_rgba(24,42,53,.08)]">
      <div className="flex items-center justify-between text-xs text-[var(--muted)]">
        <span>{label}</span>
        <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-[var(--teal-2)] text-base">{icon}</span>
      </div>
      <div className="mt-3 text-[29px] font-extrabold tracking-tight">{value}</div>
      <p className={`mt-1 text-[11px] ${up ? "font-bold text-[var(--teal)]" : "text-[var(--muted)]"}`}>{foot}</p>
    </Link>
  );
}

function Todo({
  icon,
  title,
  body,
  count,
  href,
  action,
  green = false,
}: {
  icon: string;
  title: string;
  body: string;
  count: number;
  href: string;
  action: string;
  green?: boolean;
}) {
  return (
    <li className="flex items-start gap-3 border-b border-[#f0f2f0] py-3.5 last:border-b-0">
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[10px] ${green ? "bg-[var(--teal-2)]" : "bg-[#fff2df]"}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <strong className="block text-xs">{title}</strong>
        <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">{body}</p>
        <Link href={href} className="mt-1 inline-block text-xs font-bold text-[var(--teal)]">{action}</Link>
      </div>
      <span className="text-sm font-extrabold">{count}</span>
    </li>
  );
}

function Progress({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="px-5 py-4">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
        <span className="font-bold">{label}</span>
        <span className="text-[11px] text-[var(--muted)]">{value}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#edf1ee]">
        <span className="block h-full rounded-full bg-[var(--teal)]" style={{ width: `${value}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-[var(--muted)]">{hint}</p>
    </div>
  );
}
