import { TeacherSchedule } from "@/components/teacher-schedule";
import { requireRole } from "@/lib/auth";
import { dayRange, formatClock, formatDateLabel, formatMonthDay, parseDateKey, shanghaiDateKey, shanghaiMinutes, shiftDate, weekStartKey } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";

const weekdayNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export default async function TeacherSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string; week?: string }>;
}) {
  const user = await requireRole("TEACHER", "teacher");
  const params = await searchParams;
  const view = params.view === "day" ? "day" : "week";
  const date = parseDateKey(params.date);
  const today = shanghaiDateKey();
  const currentWeek = weekStartKey(today);
  const earliestWeek = shiftDate(currentWeek, -84);
  const latestWeek = shiftDate(currentWeek, 182);
  const requestedWeek = weekStartKey(parseDateKey(params.week ?? date));
  const weekStart = requestedWeek < earliestWeek ? earliestWeek : requestedWeek > latestWeek ? latestWeek : requestedWeek;
  const previousCandidate = shiftDate(weekStart, -7);
  const nextCandidate = shiftDate(weekStart, 7);
  const range = view === "week"
    ? { start: dayRange(weekStart).start, end: dayRange(shiftDate(weekStart, 7)).start }
    : dayRange(date);
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
          course: { select: { id: true, name: true } },
          teacher: { select: { name: true } },
          students: {
            include: { student: { select: { name: true, status: true, archiveReason: true } } },
            orderBy: { student: { name: "asc" } },
          },
        },
        orderBy: { startAt: "asc" },
      })
    : [];

  return (
    <TeacherSchedule
      view={view}
      date={date}
      previousDate={shiftDate(date, -1)}
      nextDate={shiftDate(date, 1)}
      dateLabel={formatDateLabel(date)}
      weekStart={weekStart}
      weekDays={weekdayNames.map((weekday, index) => {
        const key = shiftDate(weekStart, index);
        return { key, weekday, dateLabel: formatMonthDay(key) };
      })}
      previousWeek={weekStart <= earliestWeek ? null : previousCandidate < earliestWeek ? earliestWeek : previousCandidate}
      nextWeek={weekStart >= latestWeek ? null : nextCandidate > latestWeek ? latestWeek : nextCandidate}
      linked={Boolean(teacher)}
      lessons={lessons.map((lesson) => {
        const startMinutes = shanghaiMinutes(lesson.startAt);
        const endMinutes = shanghaiMinutes(lesson.endAt);
        return {
          id: lesson.id,
          title: lesson.title ?? "课次",
          dateKey: shanghaiDateKey(lesson.startAt),
          dateLabel: formatMonthDay(shanghaiDateKey(lesson.startAt)),
          startLabel: formatClock(lesson.startAt),
          endLabel: formatClock(lesson.endAt),
          startMinutes,
          endMinutes: endMinutes > startMinutes ? endMinutes : startMinutes + 60,
          courseId: lesson.courseId,
          courseName: lesson.course.name,
          teacherName: lesson.teacher.name,
          location: lesson.location,
          status: lesson.status,
          students: lesson.students.map((row) => ({
            id: row.studentId,
            name: row.student.name,
            inactive: row.student.status !== "ACTIVE",
            archiveReason: row.student.archiveReason,
            attendanceStatus: row.attendanceStatus,
            attendanceNote: row.attendanceNote,
          })),
        };
      })}
    />
  );
}
