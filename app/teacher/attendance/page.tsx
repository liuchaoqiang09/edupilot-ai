import { TeacherAttendanceBoard } from "@/components/teacher-attendance";
import { requireRole } from "@/lib/auth";
import { calendarDateKey } from "@/lib/course-hours";
import { dayRange, formatClock, formatDateLabel, parseDateKey, shanghaiDateKey, shiftDate } from "@/lib/datetime";
import { mapTeacherLessons } from "@/lib/teacher-lesson-map";
import { prisma } from "@/lib/prisma";

const lessonInclude = {
  course: { select: { id: true, name: true, billingType: true as const } },
  classGroup: { select: { capacity: true, name: true } },
  classroom: { select: { name: true, capacity: true } },
  teacher: { select: { name: true } },
  students: {
    include: {
      student: { select: { name: true, status: true, archiveReason: true, guardianPhone: true } },
      makeupSource: { select: { lessonSession: { select: { startAt: true } } } },
      makeups: { select: { id: true }, take: 1 },
    },
    orderBy: { student: { name: "asc" as const } },
  },
};

export default async function TeacherAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; date?: string; lesson?: string }>;
}) {
  const user = await requireRole("TEACHER", "teacher");
  const params = await searchParams;
  const tab = params.tab === "pending" || params.tab === "day" ? params.tab : "today";
  const today = shanghaiDateKey();
  const date = parseDateKey(params.date ?? today);
  const teacher = await prisma.teacher.findFirst({
    where: { userId: user.id, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  const now = new Date();
  const todayRange = dayRange(today);
  const dayWindow = dayRange(date);

  const lessons = !teacher
    ? []
    : params.lesson
      ? await prisma.lessonSession.findMany({
          where: { id: params.lesson, organizationId: user.organizationId, teacherId: teacher.id },
          include: lessonInclude,
        })
      : tab === "today"
        ? await prisma.lessonSession.findMany({
            where: {
              organizationId: user.organizationId,
              teacherId: teacher.id,
              status: { not: "CANCELLED" },
              startAt: { gte: todayRange.start, lt: todayRange.end },
            },
            include: lessonInclude,
            orderBy: { startAt: "asc" },
          })
        : tab === "day"
          ? await prisma.lessonSession.findMany({
              where: {
                organizationId: user.organizationId,
                teacherId: teacher.id,
                startAt: { gte: dayWindow.start, lt: dayWindow.end },
              },
              include: lessonInclude,
              orderBy: { startAt: "asc" },
            })
          : await prisma.lessonSession.findMany({
              where: {
                organizationId: user.organizationId,
                teacherId: teacher.id,
                status: { not: "CANCELLED" },
                startAt: { gte: dayRange(shiftDate(today, -14)).start, lt: dayRange(shiftDate(today, 3)).start },
                students: { some: { attendanceStatus: "NOT_MARKED", student: { status: "ACTIVE" } } },
              },
              include: lessonInclude,
              orderBy: { startAt: "asc" },
            });

  const studentIds = [...new Set(lessons.flatMap((lesson) => lesson.students.map((row) => row.studentId)))];
  const courseIds = [...new Set(lessons.map((lesson) => lesson.courseId))];
  const [balances, courseEnrollments, makeupPool] = teacher
    ? await Promise.all([
        studentIds.length === 0
          ? Promise.resolve([])
          : prisma.courseHourBalance.findMany({
              where: { organizationId: user.organizationId, studentId: { in: studentIds }, courseId: { in: courseIds } },
              select: { studentId: true, courseId: true, remainingHours: true },
            }),
        studentIds.length === 0
          ? Promise.resolve([])
          : prisma.enrollment.findMany({
              where: { organizationId: user.organizationId, studentId: { in: studentIds }, courseId: { in: courseIds } },
              select: { studentId: true, courseId: true, startDate: true, endDate: true },
            }),
        prisma.lessonSession.findMany({
          where: { organizationId: user.organizationId, teacherId: teacher.id, status: { not: "CANCELLED" } },
          select: { id: true, courseId: true, title: true, startAt: true },
          orderBy: { startAt: "desc" },
          take: 80,
        }),
      ])
    : [[], [], []];

  const hoursLeft = new Map(balances.map((row) => [`${row.studentId}:${row.courseId}`, row.remainingHours]));
  const enrolledKeys = new Set(courseEnrollments.map((row) => `${row.studentId}:${row.courseId}`));
  const windows = new Map<string, { start: string; end: string }[]>();
  for (const row of courseEnrollments) {
    if (!row.startDate || !row.endDate) continue;
    const key = `${row.studentId}:${row.courseId}`;
    windows.set(key, [...(windows.get(key) ?? []), { start: calendarDateKey(row.startDate), end: calendarDateKey(row.endDate) }]);
  }

  const mapped = mapTeacherLessons(lessons, { today, now, hoursLeft, enrolledKeys, windows });
  const openLesson = params.lesson ? mapped.find((lesson) => lesson.id === params.lesson) ?? null : null;

  return (
    <TeacherAttendanceBoard
      tab={tab}
      date={date}
      today={today}
      previousDate={shiftDate(date, -1)}
      nextDate={shiftDate(date, 1)}
      dateLabel={formatDateLabel(date)}
      lessons={mapped}
      openLesson={openLesson}
      linked={Boolean(teacher)}
      makeupOptions={makeupPool.map((lesson) => ({
        id: lesson.id,
        courseId: lesson.courseId,
        label: `${formatDateLabel(shanghaiDateKey(lesson.startAt))} ${formatClock(lesson.startAt)} ${lesson.title ?? "课次"}`,
      }))}
    />
  );
}
