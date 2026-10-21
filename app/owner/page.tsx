import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { ownerOverview } from "@/lib/dashboard";
import { formatClock, formatDateLabel } from "@/lib/datetime";

const barColors = ["bg-[#91c8b5]", "bg-[#e8b56d]", "bg-[#b7a6e3]"];

function changeText(current: number, previous: number) {
  if (previous === 0) return current === 0 ? "上月也是 0" : "上月为 0";
  const value = Math.round(((current - previous) / previous) * 1000) / 10;
  return `${value > 0 ? "+" : ""}${value}% 较上月`;
}

function hello(name: string) {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", hour: "numeric", hourCycle: "h23" }).format(new Date()),
  );
  const part = hour < 12 ? "早上好" : hour < 18 ? "下午好" : "晚上好";
  return `${part}，${name}`;
}

export default async function OwnerHomePage() {
  const user = await requireRole("OWNER", "owner");
  const data = await ownerOverview(user.organizationId);
  const maxWeek = Math.max(...data.weeks.map((week) => week.count), 0);
  const openItems = (data.pendingReports > 0 ? 1 : 0) + (data.missingRecords > 0 ? 1 : 0) + (data.renewingCount > 0 ? 1 : 0);
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
          <h1 className="text-[28px] font-semibold tracking-tight">{hello(user.name)}</h1>
          <p className="mt-2 text-sm leading-7 text-[var(--muted)]">这是{user.organizationName}今天的教学与经营概况。数字只来自当前机构的数据库。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/owner/schedule" className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold">▣ 查看课表</Link>
          <Link href="/owner/students" className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white">＋ 新增学员</Link>
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon="♙" label="在读学员" value={data.activeStudents} foot={data.newStudents > 0 ? `本月新增 ${data.newStudents}` : "本月还没有新增学员"} up={data.newStudents > 0} />
        <StatCard icon="▦" label="今日课程" value={data.lessons.length} foot={`已排课 ${data.lessons.length} 节 · ${data.missingRecords} 节待记录`} />
        <StatCard icon="¥" label="待续费学员" value={data.renewingCount} foot={data.renewingCount === 0 ? "课时都不少于 8 节，周期课程也在有效期内" : "课时不足 8 节，或周期课程已过期"} />
        <StatCard icon="✳" label="待确认报告" value={data.pendingReports} foot={data.pendingReports === 0 ? "目前没有等待确认的报告" : "草稿、已确认或已退回，家长还看不到"} />
      </div>

      <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.8fr)]">
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
            <ul className="px-5">
              {data.lessons.map((lesson, index) => {
                const status = lesson.teachingRecord ? "已记录" : "待填写记录";
                return (
                  <li key={lesson.id} className="grid grid-cols-[58px_4px_minmax(0,1fr)] items-center gap-3 border-b border-[#f0f2f0] py-4 last:border-b-0 sm:grid-cols-[58px_4px_minmax(0,1fr)_auto]">
                    <div className="text-xs font-extrabold">
                      {formatClock(lesson.startAt)}
                      <small className="mt-1 block font-medium text-[var(--muted)]">{formatClock(lesson.endAt)}</small>
                    </div>
                    <span className={`h-10 rounded ${barColors[index % barColors.length]}`} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold">{lesson.course.name} · {lesson.title ?? "课次"}</div>
                      <div className="mt-1 truncate text-[11px] text-[var(--muted)]">{lesson.teacher.name} · {lesson._count.students} 人 · {lesson.location ?? "教室待定"}</div>
                    </div>
                    <span className={`hidden rounded-full px-2 py-1 text-[10px] font-bold sm:inline ${status === "待填写记录" ? "bg-[#fff2df] text-[#9a6729]" : "bg-[#edf5f1] text-[#34725d]"}`}>{status}</span>
                  </li>
                );
              })}
            </ul>
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
          <Progress label="课堂记录已提交" value={data.rates.recorded} hint={data.rates.lessonCount === 0 ? "今天没有课次" : `${data.rates.lessonCount} 节课`} />
          <Progress label="AI 分析已生成" value={data.rates.generated} hint={data.rates.expectedReports === 0 ? "今天没有学员名单" : `${data.rates.expectedReports} 位学员`} />
          <Progress label="报告已发布" value={data.rates.published} hint={data.rates.expectedReports === 0 ? "今天没有学员名单" : `${data.rates.expectedReports} 位学员`} />
        </section>
        </div>

        <div className="grid gap-4">
        <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-[#edf0ee] px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold">需要你处理</h2>
              <p className="mt-1 text-[11px] text-[var(--muted)]">优先处理影响教学流程的事项</p>
            </div>
            <span className="rounded-full bg-[#fff2df] px-2 py-1 text-[10px] font-bold text-[#9a6729]">{openItems} 项</span>
          </div>
          <ul className="px-5">
            <Todo icon="✳" title="AI 教学报告待确认" body={reportHint} count={data.pendingReports} href="/owner/reports" action="去查看 →" />
            <Todo icon="¥" title="学员续费跟进" body={data.renewingCount === 0 ? "目前没有课时不足或周期课程已过期的学员。" : `有 ${data.renewingCount} 位学员需要续费：课时不足 8 节，或周期课程已过期。`} count={data.renewingCount} href="/owner/billing" action="去跟进 →" green />
            <Todo icon="▣" title="教学记录完成情况" body={data.lessons.length === 0 ? "今天没有需要填写的课次。" : data.missingRecords === 0 ? "今天的课次都已经有课堂记录。" : `今天仍有 ${data.missingRecords} 节课未提交课堂记录。`} count={data.missingRecords} href="/owner/schedule" action="查看进度 →" />
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
        </div>
      </div>
    </section>
  );
}

function StatCard({ icon, label, value, foot, up = false }: { icon: string; label: string; value: number; foot: string; up?: boolean }) {
  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
      <div className="flex items-center justify-between text-xs text-[var(--muted)]">
        <span>{label}</span>
        <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-[var(--teal-2)] text-base">{icon}</span>
      </div>
      <div className="mt-3 text-[29px] font-extrabold tracking-tight">{value}</div>
      <p className={`mt-1 text-[11px] ${up ? "font-bold text-[var(--teal)]" : "text-[var(--muted)]"}`}>{foot}</p>
    </article>
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
