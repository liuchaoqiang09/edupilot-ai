import { notFound } from "next/navigation";
import { TeacherHomeworkLesson } from "@/components/teacher-homework";
import { requireRole } from "@/lib/auth";
import { formatClock, formatDateLabel, formatDateTime, shanghaiDateKey } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";

export default async function TeacherHomeworkLessonPage({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const user = await requireRole("TEACHER", "teacher");
  const { lessonId } = await params;
  const teacher = await prisma.teacher.findFirst({
    where: { userId: user.id, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!teacher) notFound();
  const lesson = await prisma.lessonSession.findFirst({
    where: {
      id: lessonId,
      organizationId: user.organizationId,
      teacherId: teacher.id,
      status: { not: "CANCELLED" },
      teachingRecord: { is: { homework: { not: "" } } },
    },
    select: {
      id: true,
      title: true,
      startAt: true,
      course: { select: { name: true } },
      teachingRecord: { select: { homework: true, homeworkDueAt: true } },
      students: {
        select: {
          id: true,
          studentId: true,
          student: { select: { name: true, status: true } },
        },
        orderBy: { student: { name: "asc" } },
      },
      homeworkSubmissions: {
        select: {
          id: true,
          studentId: true,
          body: true,
          status: true,
          feedback: true,
          score: true,
          submittedAt: true,
          assets: { select: { id: true, kind: true, fileName: true }, orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
  if (!lesson) notFound();
  const assignment = lesson.teachingRecord?.homework?.trim() ?? "";
  if (!assignment) notFound();
  const byStudent = new Map(lesson.homeworkSubmissions.map((row) => [row.studentId, row]));

  return (
    <TeacherHomeworkLesson
      lessonId={lesson.id}
      title={`${lesson.course.name} · ${lesson.title ?? "课次"}`}
      when={`${formatDateLabel(shanghaiDateKey(lesson.startAt))} ${formatClock(lesson.startAt)}`}
      assignment={assignment}
      dueLabel={lesson.teachingRecord?.homeworkDueAt ? formatDateTime(lesson.teachingRecord.homeworkDueAt) : null}
      students={lesson.students.map((row) => {
          const submission = byStudent.get(row.studentId) ?? null;
          const inactive = row.student.status !== "ACTIVE";
          return {
            lessonStudentId: row.id,
            submissionId: submission?.id ?? null,
            studentName: inactive ? `${row.student.name}（已停用）` : row.student.name,
            status: submission?.status ?? null,
            body: submission?.body ?? "",
            feedback: submission?.feedback ?? "",
            score: submission?.score ?? "",
            submittedLabel: submission?.submittedAt ? formatDateTime(submission.submittedAt) : null,
            assets: (submission?.assets ?? []).map((asset) => ({ id: asset.id, kind: asset.kind, fileName: asset.fileName })),
          };
        })}
    />
  );
}
