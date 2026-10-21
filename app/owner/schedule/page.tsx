import { ScheduleBoard } from "@/components/schedule-board";
import { requireRole } from "@/lib/auth";
import { dayRange, formatClock, formatDateLabel, parseDateKey, shiftDate } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";

export default async function OwnerSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const user = await requireRole("OWNER", "owner");
  const params = await searchParams;
  const date = parseDateKey(params.date);
  const range = dayRange(date);

  const [lessons, classes, teachers, students] = await Promise.all([
    prisma.lessonSession.findMany({
      where: { organizationId: user.organizationId, startAt: { gte: range.start, lt: range.end } },
      include: {
        course: { select: { name: true } },
        classGroup: { select: { name: true } },
        teacher: { select: { id: true, name: true } },
        students: {
          include: { student: { select: { name: true } } },
          orderBy: { student: { name: "asc" } },
        },
      },
      orderBy: { startAt: "asc" },
    }),
    prisma.classGroup.findMany({
      where: { organizationId: user.organizationId, status: "ACTIVE" },
      include: { course: { select: { name: true } }, teacher: { select: { id: true, name: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.teacher.findMany({
      where: { organizationId: user.organizationId, status: "ACTIVE" },
      select: { id: true, name: true, userId: true },
      orderBy: { name: "asc" },
    }),
    prisma.student.findMany({
      where: { organizationId: user.organizationId, status: "ACTIVE" },
      select: { id: true, name: true, grade: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <ScheduleBoard
      date={date}
      previousDate={shiftDate(date, -1)}
      nextDate={shiftDate(date, 1)}
      dateLabel={formatDateLabel(date)}
      lessons={lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title ?? `${lesson.course.name} · ${lesson.classGroup.name}`,
        startLabel: formatClock(lesson.startAt),
        endLabel: formatClock(lesson.endAt),
        courseName: lesson.course.name,
        className: lesson.classGroup.name,
        teacherId: lesson.teacher.id,
        teacherName: lesson.teacher.name,
        location: lesson.location,
        status: lesson.status,
        students: lesson.students.map((row) => ({
          id: row.studentId,
          name: row.student.name,
          attendanceStatus: row.attendanceStatus,
          attendanceNote: row.attendanceNote,
        })),
      }))}
      classes={classes.map((item) => ({
        id: item.id,
        name: item.name,
        courseName: item.course.name,
        teacherId: item.teacher.id,
        teacherName: item.teacher.name,
      }))}
      teachers={teachers.map((teacher) => ({ id: teacher.id, name: teacher.name, linked: Boolean(teacher.userId) }))}
      students={students}
    />
  );
}
