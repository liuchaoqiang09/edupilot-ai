import { ScheduleBoard, type ScheduleLesson } from "@/components/schedule-board";
import { requireRole } from "@/lib/auth";
import { dayRange, formatClock, formatDateLabel, formatMonthDay, parseDateKey, shanghaiDateKey, shanghaiMinutes, shiftDate, weekStartKey } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";

const weekdayNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export default async function OwnerSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string; week?: string; status?: string; range?: string }>;
}) {
  const user = await requireRole("OWNER", "owner");
  const params = await searchParams;
  const next7Days = params.range === "next7days";
  const view = next7Days ? "day" : params.view === "week" ? "week" : "day";
  const pendingRecords = !next7Days && view === "day" && params.status === "待填写";
  const pendingAll = pendingRecords && !params.date;
  const date = parseDateKey(params.date);
  const today = shanghaiDateKey();
  const currentWeek = weekStartKey(today);
  const earliestWeek = shiftDate(currentWeek, -14);
  const requestedWeek = weekStartKey(parseDateKey(params.week ?? date));
  const weekStart = requestedWeek < earliestWeek ? earliestWeek : requestedWeek;
  const previousCandidate = shiftDate(weekStart, -7);
  const range = view === "week"
    ? { start: dayRange(weekStart).start, end: dayRange(shiftDate(weekStart, 7)).start }
    : dayRange(date);
  const now = new Date();
  const next7Range = { start: dayRange(today).start, end: dayRange(shiftDate(today, 7)).start };
  const lessonWhere = pendingAll
    ? { organizationId: user.organizationId, status: { not: "CANCELLED" as const }, endAt: { lte: now }, teachingRecord: { is: null } }
    : next7Days
      ? { organizationId: user.organizationId, status: { not: "CANCELLED" as const }, startAt: { gte: next7Range.start, lt: next7Range.end } }
      : { organizationId: user.organizationId, startAt: { gte: range.start, lt: range.end } };

  const [lessons, classes, teachers] = await Promise.all([
    prisma.lessonSession.findMany({
      where: lessonWhere,
      include: {
        course: { select: { id: true, name: true } },
        classGroup: { select: { name: true } },
        teacher: { select: { id: true, name: true } },
        teachingRecord: { select: { id: true } },
        students: {
          include: {
            student: {
              select: {
                name: true,
                grade: true,
                age: true,
                parentLinks: { select: { parent: { select: { name: true, phone: true, email: true } } } },
              },
            },
          },
          orderBy: { student: { name: "asc" } },
        },
      },
      orderBy: { startAt: pendingAll ? "desc" : "asc" },
    }),
    prisma.classGroup.findMany({
      where: { organizationId: user.organizationId, status: "ACTIVE" },
      include: { course: { select: { name: true } }, teacher: { select: { id: true, name: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.teacher.findMany({
      where: { organizationId: user.organizationId, status: "ACTIVE" },
      select: { id: true, name: true, user: { select: { roles: true } } },
      orderBy: { name: "asc" },
    }),
  ]);

  const visibleLessons = pendingAll
    ? lessons
    : pendingRecords
    ? lessons.filter((lesson) => lesson.status !== "CANCELLED" && !lesson.teachingRecord && lesson.endAt <= now)
    : lessons;
  const mapped: ScheduleLesson[] = visibleLessons.map((lesson) => {
    const startMinutes = shanghaiMinutes(lesson.startAt);
    const endMinutes = shanghaiMinutes(lesson.endAt);
    return {
      id: lesson.id,
      title: lesson.title ?? `${lesson.course.name} · ${lesson.classGroup.name}`,
      dateKey: shanghaiDateKey(lesson.startAt),
      dateLabel: formatMonthDay(shanghaiDateKey(lesson.startAt)),
      startLabel: formatClock(lesson.startAt),
      endLabel: formatClock(lesson.endAt),
      startMinutes,
      endMinutes: endMinutes > startMinutes ? endMinutes : startMinutes + 60,
      courseId: lesson.course.id,
      courseName: lesson.course.name,
      className: lesson.classGroup.name,
      teacherId: lesson.teacher.id,
      teacherName: lesson.teacher.name,
      location: lesson.location,
      status: lesson.status,
      students: lesson.students.map((row) => ({
        id: row.studentId,
        name: row.student.name,
        grade: row.student.grade,
        age: row.student.age,
        parentContact: row.student.parentLinks.length === 0
          ? "未绑定家长"
          : row.student.parentLinks.map((link) => `${link.parent.name} ${link.parent.phone || link.parent.email}`).join("、"),
        attendanceStatus: row.attendanceStatus,
        attendanceNote: row.attendanceNote,
      })),
    };
  });

  return (
    <ScheduleBoard
      view={view}
      pendingRecords={pendingRecords}
      spanDates={pendingAll}
      next7Days={next7Days}
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
      nextWeek={shiftDate(weekStart, 7)}
      lessons={mapped}
      classes={classes.map((item) => ({
        id: item.id,
        name: item.name,
        courseId: item.courseId,
        courseName: item.course.name,
        teacherId: item.teacher.id,
        teacherName: item.teacher.name,
      }))}
      teachers={teachers.map((teacher) => ({ id: teacher.id, name: teacher.name, linked: teacher.user?.roles.includes("TEACHER") ?? false }))}
    />
  );
}
