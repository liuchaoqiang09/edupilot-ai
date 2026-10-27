import { ReportReplyForm } from "@/app/parent/reports/reply-form";
import { ParentChildFilter } from "@/components/parent-child-filter";
import { requireRole } from "@/lib/auth";
import { formatClock, formatDateLabel, shanghaiDateKey } from "@/lib/datetime";
import { linkedParentChildren, pickLinkedChildId } from "@/lib/parent-scope";
import { prisma } from "@/lib/prisma";
import { markPublishedReportsRead } from "@/lib/report-read";
import { reportsVisibleToParent } from "@/lib/report-flow";

export default async function ParentReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string }>;
}) {
  const user = await requireRole("PARENT", "parent");
  const params = await searchParams;
  const children = await linkedParentChildren(user.organizationId, user.id);
  const studentId = pickLinkedChildId(children, params.student);
  const all = await reportsVisibleToParent(prisma, { id: user.id, organizationId: user.organizationId });
  const reports = studentId ? all.filter((report) => report.studentId === studentId) : all;
  // 服务端在返回页面前写入已读，即使家长马上关掉网页，已打开的报告也会记上。
  await markPublishedReportsRead(user.organizationId, user.id, reports.map((report) => report.id));

  return (
    <section>
      <h1 className="text-[28px] font-semibold tracking-tight">学习报告</h1>
      <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">只显示教师确认并发布、且属于已绑定孩子的报告。草稿、退回内容和教师内部备注都不会出现在这里。</p>
      <ParentChildFilter basePath="/parent/reports" childrenList={children} selectedId={studentId} />
      <div className="mt-6 space-y-4">
        {reports.length === 0 ? <p className="rounded-2xl border border-[var(--line)] bg-white px-4 py-12 text-center text-sm text-[var(--muted)]">还没有已发布的报告。</p> : reports.map((report) => (
          <article key={report.id} className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="break-words text-base font-semibold">{report.lessonSession.title ?? "课次"}</h2>
                <p className="mt-1 text-xs text-[var(--muted)]">{report.student.name} · {report.lessonSession.teacher.name} · {formatDateLabel(shanghaiDateKey(report.lessonSession.startAt))} {formatClock(report.lessonSession.startAt)}</p>
              </div>
              <span className="rounded-full bg-[#edf5f1] px-2 py-1 text-[10px] font-bold text-[#34725d]">已发布</span>
            </div>
            <Section title="本次学习总结" body={report.summary} />
            <Section title="做得好的方面" body={report.strengths} />
            <Section title="需要改进" body={report.issues} />
            <Section title="下一步建议" body={report.nextSteps} />
            {report.homeworkSummary ? <Section title="作业建议" body={report.homeworkSummary} /> : null}
            {report.photos.length > 0 ? (
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {report.photos.map((photo) => (
                  <img key={photo.id} src={`/api/report-photos/${photo.id}`} alt="课堂照片" className="h-44 w-full max-w-full rounded-xl object-cover" />
                ))}
              </div>
            ) : null}
            <ReportReplyForm reportId={report.id} initial={report.replies[0]?.body ?? ""} />
          </article>
        ))}
      </div>
    </section>
  );
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-4 min-w-0">
      <h3 className="text-xs font-bold">{title}</h3>
      <p className="mt-1 overflow-hidden whitespace-pre-wrap break-words rounded-xl bg-[#f7f9f6] px-3 py-3 text-sm leading-7 text-[#42565a]">{body || "暂无内容"}</p>
    </div>
  );
}
