import { TeacherRecords } from "@/components/teacher-records";
import { requireRole } from "@/lib/auth";
import { formatClock, formatDateLabel, shanghaiDateKey } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";

export default async function TeacherRecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ lesson?: string; report?: string }>;
}) {
  const user = await requireRole("TEACHER", "teacher");
  const params = await searchParams;
  const teacher = await prisma.teacher.findFirst({
    where: { userId: user.id, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  const lessons = teacher
    ? await prisma.lessonSession.findMany({
        where: { organizationId: user.organizationId, teacherId: teacher.id, status: { not: "CANCELLED" } },
        include: {
          teachingRecord: true,
          students: { include: { student: { select: { name: true, status: true, archiveReason: true } } }, orderBy: { student: { name: "asc" } } },
          reports: { include: { student: { select: { name: true } } }, orderBy: { student: { name: "asc" } } },
        },
        orderBy: { startAt: "desc" },
        take: 30,
      })
    : [];
  if (teacher && params.lesson && !lessons.some((lesson) => lesson.id === params.lesson)) {
    const extra = await prisma.lessonSession.findFirst({
      where: { id: params.lesson, organizationId: user.organizationId, teacherId: teacher.id },
      include: {
        teachingRecord: true,
        students: { include: { student: { select: { name: true, status: true, archiveReason: true } } }, orderBy: { student: { name: "asc" } } },
        reports: { include: { student: { select: { name: true } } }, orderBy: { student: { name: "asc" } } },
      },
    });
    if (extra) lessons.unshift(extra);
  }
  const now = Date.now();
  const organization = await prisma.organization.findUnique({
    where: { id: user.organizationId },
    select: { aiTeacherMustConfirm: true },
  });

  return (
    <TeacherRecords
      initialLessonId={params.lesson ?? ""}
      initialReportId={params.report ?? ""}
      requireTeacherConfirm={organization?.aiTeacherMustConfirm !== false}
      lessons={lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title ?? "课次",
        when: `${formatDateLabel(shanghaiDateKey(lesson.startAt))} ${formatClock(lesson.startAt)}–${formatClock(lesson.endAt)}`,
        ended: lesson.endAt.getTime() <= now,
        students: lesson.students.map((row) => ({
          id: row.studentId,
          name: row.student.name,
          inactive: row.student.status !== "ACTIVE",
          archiveReason: row.student.archiveReason,
        })),
        record: lesson.teachingRecord
          ? {
              lessonContent: lesson.teachingRecord.lessonContent,
              studentPerformance: lesson.teachingRecord.studentPerformance,
              difficulties: lesson.teachingRecord.difficulties,
              homework: lesson.teachingRecord.homework ?? "",
              teacherPrivateNote: lesson.teachingRecord.teacherPrivateNote ?? "",
            }
          : null,
        reports: lesson.reports.map((report) => ({
          id: report.id,
          studentId: report.studentId,
          studentName: report.student.name,
          status: report.status,
          summary: report.summary,
          strengths: report.strengths,
          issues: report.issues,
          nextSteps: report.nextSteps,
          homeworkSummary: report.homeworkSummary ?? "",
          revisionNote: report.revisionNote,
          revision: report.revision,
        })),
      }))}
    />
  );
}
