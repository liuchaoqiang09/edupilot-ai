import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { formatClock, formatDateLabel, shanghaiDateKey } from "@/lib/datetime";
import { reportStatusLabel } from "@/lib/report-labels";
import { prisma } from "@/lib/prisma";

export default async function TeacherReportsPage() {
  const user = await requireRole("TEACHER", "teacher");
  const teacher = await prisma.teacher.findFirst({
    where: { userId: user.id, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  const reports = teacher
    ? await prisma.teachingReport.findMany({
        where: { organizationId: user.organizationId, lessonSession: { teacherId: teacher.id } },
        include: {
          student: { select: { name: true } },
          lessonSession: { select: { title: true, startAt: true } },
          reads: { orderBy: { openedAt: "asc" }, select: { openedAt: true, parent: { select: { name: true } } } },
        },
        orderBy: { updatedAt: "desc" },
      })
    : [];

  return (
    <section>
      <h1 className="text-[28px] font-semibold tracking-tight">教学报告</h1>
      <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">这里只列出你自己课次上的报告。编辑和发布仍在教学记录页完成。</p>
      <div className="mt-6 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        {reports.length === 0 ? <p className="px-4 py-12 text-center text-sm text-[var(--muted)]">还没有报告。</p> : (
          <ul>
            {reports.map((report) => (
              <li key={report.id} className="border-t border-[#eef1ee] first:border-t-0">
                <Link href={`/teacher/records?lesson=${report.lessonSessionId}&report=${report.id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 transition hover:bg-[#f4faf7]">
                  <div>
                    <div className="text-sm font-bold">{report.student.name} · {report.lessonSession.title ?? "课次"}</div>
                    <div className="mt-1 text-xs text-[var(--muted)]">{formatDateLabel(shanghaiDateKey(report.lessonSession.startAt))} {formatClock(report.lessonSession.startAt)}</div>
                  </div>
                  <div className="text-right">
                    <span className="rounded-full bg-[#edf5f1] px-2 py-1 text-[10px] font-bold text-[#34725d]">{reportStatusLabel[report.status]}</span>
                    {report.status === "PUBLISHED" ? (
                      <div className="mt-1 text-[10px] text-[var(--muted)]">
                        {report.reads.length > 0 ? `已查看 · ${report.reads.map((read) => read.parent.name).join("、")}` : "未查看"}
                      </div>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
