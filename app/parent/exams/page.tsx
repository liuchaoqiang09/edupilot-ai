import Link from "next/link";
import { ParentChildFilter } from "@/components/parent-child-filter";
import { requireRole } from "@/lib/auth";
import { formatDateLabel, shanghaiDateKey } from "@/lib/datetime";
import { resultDisplay } from "@/lib/exam";
import { linkedParentChildren, pickLinkedChildId } from "@/lib/parent-scope";
import { prisma } from "@/lib/prisma";

export default async function ParentExamsPage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string }>;
}) {
  const user = await requireRole("PARENT", "parent");
  const params = await searchParams;
  const children = await linkedParentChildren(user.organizationId, user.id);
  const studentId = pickLinkedChildId(children, params.student);
  const studentIds = studentId ? [studentId] : children.map((child) => child.id);

  const results = studentIds.length === 0
    ? []
    : await prisma.examResult.findMany({
        where: {
          organizationId: user.organizationId,
          studentId: { in: studentIds },
          entered: true,
          exam: { status: "PUBLISHED" },
        },
        select: {
          id: true,
          studentId: true,
          score: true,
          gradeLabel: true,
          absent: true,
          entered: true,
          student: { select: { name: true } },
          exam: {
            select: {
              id: true,
              title: true,
              examDate: true,
              scoreMode: true,
              maxScore: true,
              course: { select: { name: true } },
              classGroup: { select: { name: true } },
              reads: {
                where: { parentUserId: user.id },
                select: { studentId: true },
              },
            },
          },
        },
        orderBy: { exam: { examDate: "desc" } },
        take: 40,
      });

  return (
    <section>
      <h1 className="text-[28px] font-semibold tracking-tight">成绩</h1>
      <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">只显示教师已发布、且已录入的孩子成绩。看不到其他学生的分数。课堂报告与作业仍在各自栏目。</p>
      <ParentChildFilter basePath="/parent/exams" childrenList={children} selectedId={studentId} />
      <div className="mt-6 space-y-3">
        {results.length === 0 ? (
          <p className="rounded-2xl border border-[var(--line)] bg-white px-4 py-12 text-center text-sm text-[var(--muted)]">还没有已发布的成绩。</p>
        ) : results.map((row) => {
          const unread = !row.exam.reads.some((read) => read.studentId === row.studentId);
          const scoreText = resultDisplay({
            mode: row.exam.scoreMode,
            score: row.score == null ? null : Number(row.score),
            gradeLabel: row.gradeLabel,
            absent: row.absent,
            entered: row.entered,
            maxScore: row.exam.maxScore == null ? null : Number(row.exam.maxScore),
          });
          return (
            <article key={row.id} className="rounded-2xl border border-[var(--line)] bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">{row.exam.title}</h2>
                  <p className="mt-1 text-xs text-[var(--muted)]">{row.student.name} · {row.exam.course.name} · {row.exam.classGroup.name} · {formatDateLabel(shanghaiDateKey(row.exam.examDate))}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {unread ? <span className="rounded-full bg-[#e8f3ff] px-2.5 py-1 text-[11px] font-bold text-[#2f5f8a]">未读</span> : null}
                  <span className="rounded-full bg-[#eef6f1] px-2.5 py-1 text-[11px] font-bold text-[#34725d]">{scoreText}</span>
                </div>
              </div>
              <Link href={`/parent/exams/${row.exam.id}?student=${row.studentId}`} className="mt-3 inline-block text-xs font-bold text-[var(--teal)]">查看详情</Link>
            </article>
          );
        })}
      </div>
    </section>
  );
}
