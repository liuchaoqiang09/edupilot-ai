import { TeacherSchedule } from "@/components/teacher-schedule";
import { requireRole } from "@/lib/auth";
import { dayRange, formatClock, formatDateLabel, parseDateKey, shiftDate } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";

export default async function TeacherHomePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const user = await requireRole("TEACHER", "teacher");
  const params = await searchParams;
  const date = parseDateKey(params.date);
  const range = dayRange(date);
  const teacher = await prisma.teacher.findFirst({
    where: { userId: user.id, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  const lessons = teacher
    ? await prisma.lessonSession.findMany({
        where: {
          organizationId: user.organizationId,
          teacherId: teacher.id,
          startAt: { gte: range.start, lt: range.end },
        },
        include: {
          students: {
            include: { student: { select: { name: true } } },
            orderBy: { student: { name: "asc" } },
          },
        },
        orderBy: { startAt: "asc" },
      })
    : [];

  return (
    <TeacherSchedule
      date={date}
      previousDate={shiftDate(date, -1)}
      nextDate={shiftDate(date, 1)}
      dateLabel={formatDateLabel(date)}
      linked={Boolean(teacher)}
      lessons={lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title ?? "课次",
        startLabel: formatClock(lesson.startAt),
        endLabel: formatClock(lesson.endAt),
        location: lesson.location,
        status: lesson.status,
        students: lesson.students.map((row) => ({
          id: row.studentId,
          name: row.student.name,
          attendanceStatus: row.attendanceStatus,
          attendanceNote: row.attendanceNote,
        })),
      }))}
    />
  );
}
