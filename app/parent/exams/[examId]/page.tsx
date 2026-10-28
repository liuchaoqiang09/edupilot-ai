import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { formatDateLabel, formatDateTime, shanghaiDateKey } from "@/lib/datetime";
import { classAverage, resultDisplay } from "@/lib/exam";
import { markExamRead } from "@/lib/exam-flow";
import { linkedParentChildren, pickLinkedChildId } from "@/lib/parent-scope";
import { prisma } from "@/lib/prisma";

export default async function ParentExamDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ examId: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const user = await requireRole("PARENT", "parent");
  const { examId } = await params;
  const query = await searchParams;
  const children = await linkedParentChildren(user.organizationId, user.id);
  const childIds = children.map((child) => child.id);
  if (childIds.length === 0) notFound();

  const exam = await prisma.exam.findFirst({
    where: { id: examId, organizationId: user.organizationId, status: "PUBLISHED" },
    select: {
      id: true,
      title: true,
      examDate: true,
      scoreMode: true,
      maxScore: true,
      classSummary: true,
      showAverage: true,
      course: { select: { name: true } },
      classGroup: { select: { name: true } },
      teacher: { select: { name: true } },
      results: {
        where: { entered: true },
        select: {
          studentId: true,
          score: true,
          gradeLabel: true,
          absent: true,
          entered: true,
          comment: true,
          student: { select: { name: true } },
        },
      },
    },
  });
  if (!exam) notFound();

  const mine = exam.results.filter((row) => childIds.includes(row.studentId));
  if (mine.length === 0) notFound();
  const preferred = pickLinkedChildId(mine.map((row) => ({ id: row.studentId })), query.student);
  const result = mine.find((row) => row.studentId === preferred) ?? mine[0];

  await markExamRead({
    organizationId: user.organizationId,
    parentUserId: user.id,
    examId: exam.id,
    studentId: result.studentId,
  });

  const average = exam.showAverage && exam.scoreMode === "POINTS"
    ? classAverage(exam.results.filter((row) => !row.absent).map((row) => (row.score == null ? null : Number(row.score))))
    : null;

  const scoreText = resultDisplay({
    mode: exam.scoreMode,
    score: result.score == null ? null : Number(result.score),
    gradeLabel: result.gradeLabel,
    absent: result.absent,
    entered: result.entered,
    maxScore: exam.maxScore == null ? null : Number(exam.maxScore),
  });

  return (
    <section className="space-y-4">
      <Link href="/parent/exams" className="text-xs font-bold text-[var(--teal)]">← 返回成绩列表</Link>
      <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
        <h1 className="text-[22px] font-semibold tracking-tight">{exam.title}</h1>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {result.student.name} · {exam.course.name} · {exam.classGroup.name} · {formatDateLabel(shanghaiDateKey(exam.examDate))} · {exam.teacher.name}
        </p>
        <p className="mt-4 text-3xl font-semibold tracking-tight text-[#34725d]">{scoreText}</p>
        {average != null ? <p className="mt-2 text-xs text-[var(--muted)]">班级均分 {average}{exam.maxScore != null ? ` / ${Number(exam.maxScore)}` : ""}（不展示名次）</p> : null}
      </div>

      {result.comment ? (
        <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <h2 className="text-sm font-semibold">老师总结</h2>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-[#42565a]">{result.comment}</p>
        </div>
      ) : null}

      {exam.classSummary ? (
        <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <h2 className="text-sm font-semibold">班级说明</h2>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-[#42565a]">{exam.classSummary}</p>
        </div>
      ) : null}

      {mine.length > 1 ? (
        <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <h2 className="text-sm font-semibold">切换孩子</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {mine.map((row) => (
              <Link
                key={row.studentId}
                href={`/parent/exams/${exam.id}?student=${row.studentId}`}
                className={`rounded-full px-3 py-1.5 text-xs font-bold ${row.studentId === result.studentId ? "bg-[var(--teal)] text-white" : "border border-[var(--line)]"}`}
              >
                {row.student.name}
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      <p className="text-xs text-[var(--muted)]">打开时间已记录为已读 · {formatDateTime(new Date())}</p>
    </section>
  );
}
