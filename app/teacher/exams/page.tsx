import Link from "next/link";
import { TeacherExamCreate } from "@/components/teacher-exam-create";
import { requireRole } from "@/lib/auth";
import { formatDateLabel, shanghaiDateKey } from "@/lib/datetime";
import { examStatusLabel } from "@/lib/exam";
import { prisma } from "@/lib/prisma";

export default async function TeacherExamsPage() {
  const user = await requireRole("TEACHER", "teacher");
  const teacher = await prisma.teacher.findFirst({
    where: { userId: user.id, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  const [classes, exams] = teacher
    ? await Promise.all([
        prisma.classGroup.findMany({
          where: { organizationId: user.organizationId, teacherId: teacher.id, status: "ACTIVE" },
          select: { id: true, name: true, course: { select: { name: true } } },
          orderBy: [{ course: { name: "asc" } }, { name: "asc" }],
        }),
        prisma.exam.findMany({
          where: { organizationId: user.organizationId, teacherId: teacher.id },
          select: {
            id: true,
            title: true,
            examDate: true,
            status: true,
            classGroup: { select: { name: true } },
            course: { select: { name: true } },
            results: { select: { entered: true } },
            reads: { select: { id: true } },
          },
          orderBy: [{ examDate: "desc" }, { createdAt: "desc" }],
          take: 40,
        }),
      ])
    : [[], []];

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight">考试成绩</h1>
        <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">为负责班级创建考试、录入成绩和个人评语，确认后发布给家长。与教学报告、作业批改分开；家长只能看到自己孩子。</p>
      </div>
      <TeacherExamCreate classes={classes.map((item) => ({ id: item.id, label: `${item.course.name} · ${item.name}` }))} />
      <div className="space-y-3">
        {exams.length === 0 ? (
          <p className="rounded-2xl border border-[var(--line)] bg-white px-4 py-12 text-center text-sm text-[var(--muted)]">还没有考试。先在上方创建一场。</p>
        ) : exams.map((exam) => {
          const entered = exam.results.filter((row) => row.entered).length;
          return (
            <article key={exam.id} className="rounded-2xl border border-[var(--line)] bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">{exam.title}</h2>
                  <p className="mt-1 text-xs text-[var(--muted)]">{exam.course.name} · {exam.classGroup.name} · {formatDateLabel(shanghaiDateKey(exam.examDate))}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${exam.status === "PUBLISHED" ? "bg-[#eef6f1] text-[#34725d]" : "bg-[#fff4e5] text-[#9a6729]"}`}>
                    {examStatusLabel[exam.status]}
                  </span>
                  <Link href={`/teacher/exams/${exam.id}`} className="rounded-[10px] border border-[var(--line)] px-3 py-2 text-xs font-bold text-[var(--teal)]">打开录入</Link>
                </div>
              </div>
              <p className="mt-3 text-xs text-[var(--muted)]">已录入 {entered}/{exam.results.length} · 家长已读 {exam.reads.length}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
