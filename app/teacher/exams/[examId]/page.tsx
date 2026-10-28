import { notFound } from "next/navigation";
import { TeacherExamEditor } from "@/components/teacher-exam-editor";
import { requireRole } from "@/lib/auth";
import { formatDateLabel, shanghaiDateKey } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";

export default async function TeacherExamDetailPage({
  params,
}: {
  params: Promise<{ examId: string }>;
}) {
  const user = await requireRole("TEACHER", "teacher");
  const { examId } = await params;
  const teacher = await prisma.teacher.findFirst({
    where: { userId: user.id, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!teacher) notFound();
  const exam = await prisma.exam.findFirst({
    where: { id: examId, organizationId: user.organizationId, teacherId: teacher.id },
    select: {
      id: true,
      title: true,
      examDate: true,
      status: true,
      scoreMode: true,
      maxScore: true,
      classSummary: true,
      showAverage: true,
      course: { select: { name: true } },
      classGroup: { select: { name: true } },
      results: {
        select: {
          studentId: true,
          score: true,
          gradeLabel: true,
          absent: true,
          entered: true,
          comment: true,
          student: { select: { name: true } },
        },
        orderBy: { student: { name: "asc" } },
      },
      reads: { select: { id: true } },
    },
  });
  if (!exam) notFound();

  return (
    <TeacherExamEditor
      examId={exam.id}
      title={exam.title}
      meta={`${exam.course.name} · ${exam.classGroup.name} · ${formatDateLabel(shanghaiDateKey(exam.examDate))}`}
      status={exam.status}
      scoreMode={exam.scoreMode}
      maxScore={exam.maxScore == null ? null : String(Number(exam.maxScore))}
      classSummary={exam.classSummary ?? ""}
      showAverage={exam.showAverage}
      readCount={exam.reads.length}
      rows={exam.results.map((row) => ({
        studentId: row.studentId,
        studentName: row.student.name,
        score: row.score == null ? "" : String(Number(row.score)),
        gradeLabel: row.gradeLabel ?? "",
        absent: row.absent,
        entered: row.entered,
        comment: row.comment ?? "",
      }))}
    />
  );
}
