import { requireRole } from "@/lib/auth";
import { formatClock, formatDateLabel, shanghaiDateKey } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { reportsVisibleToParent } from "@/lib/report-flow";

export default async function ParentReportsPage() {
  const user = await requireRole("PARENT", "parent");
  const reports = await reportsVisibleToParent(prisma, { id: user.id, organizationId: user.organizationId });

  return (
    <section>
      <h1 className="text-[28px] font-semibold tracking-tight">学习报告</h1>
      <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">只显示教师确认并发布、且属于已绑定孩子的报告。草稿、退回内容和教师内部备注都不会出现在这里。</p>
      <div className="mt-6 space-y-4">
        {reports.length === 0 ? <p className="rounded-2xl border border-[var(--line)] bg-white px-4 py-12 text-center text-sm text-[var(--muted)]">还没有已发布的报告。</p> : reports.map((report) => (
          <article key={report.id} className="rounded-2xl border border-[var(--line)] bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">{report.lessonSession.title ?? "课次"}</h2>
                <p className="mt-1 text-xs text-[var(--muted)]">{report.student.name} · {report.lessonSession.teacher.name} · {formatDateLabel(shanghaiDateKey(report.lessonSession.startAt))} {formatClock(report.lessonSession.startAt)}</p>
              </div>
              <span className="rounded-full bg-[#edf5f1] px-2 py-1 text-[10px] font-bold text-[#34725d]">已发布</span>
            </div>
            <Section title="本次学习总结" body={report.summary} />
            <Section title="做得好的方面" body={report.strengths} />
            <Section title="需要改进" body={report.issues} />
            <Section title="下一步建议" body={report.nextSteps} />
            {report.homeworkSummary ? <Section title="作业建议" body={report.homeworkSummary} /> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-4">
      <h3 className="text-xs font-bold">{title}</h3>
      <p className="mt-1 rounded-xl bg-[#f7f9f6] px-3 py-3 text-sm leading-7 text-[#42565a]">{body}</p>
    </div>
  );
}
