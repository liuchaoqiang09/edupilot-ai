import { requireRole } from "@/lib/auth";
import { formatDateLabel, shanghaiDateKey } from "@/lib/datetime";
import { examStatusLabel } from "@/lib/exam";
import { prisma } from "@/lib/prisma";

export default async function OwnerExamsPage() {
  const user = await requireRole("OWNER", "owner");
  const exams = await prisma.exam.findMany({
    where: { organizationId: user.organizationId },
    select: {
      id: true,
      title: true,
      examDate: true,
      status: true,
      classGroup: { select: { name: true } },
      course: { select: { name: true } },
      teacher: { select: { name: true } },
      results: { select: { entered: true } },
      reads: { select: { id: true } },
    },
    orderBy: [{ examDate: "desc" }, { createdAt: "desc" }],
    take: 60,
  });

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-[var(--ink)]">考试成绩（只读）</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
          负责人可查看本机构全部考试与家长已读情况。录入与发布请在教师端「考试成绩」办理。
        </p>
      </div>
      {exams.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--line)] bg-white px-4 py-8 text-center text-sm text-[var(--muted)]">
          还没有考试。教师创建并发布后会出现在这里。
        </p>
      ) : (
        <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-xl border border-[var(--line)] bg-white">
          {exams.map((exam) => {
            const entered = exam.results.filter((row) => row.entered).length;
            return (
              <li key={exam.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <p className="font-bold text-[var(--ink)]">{exam.title}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {formatDateLabel(shanghaiDateKey(exam.examDate))} · {exam.course.name} · {exam.classGroup.name} · {exam.teacher.name}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
                  <span>{examStatusLabel[exam.status]}</span>
                  <span>
                    已录入 {entered}/{exam.results.length}
                  </span>
                  <span>家长已读 {exam.reads.length}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
