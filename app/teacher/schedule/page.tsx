import { TeacherSchedule } from "@/components/teacher-schedule";
import { requireRole } from "@/lib/auth";
import { formatCourseUsage } from "@/lib/billing-list";
import { calendarDateKey, periodValidity } from "@/lib/course-hours";
import { dayRange, formatClock, formatDateLabel, formatMonthDay, parseDateKey, shanghaiDateKey, shanghaiMinutes, shiftDate, weekStartKey } from "@/lib/datetime";
import { makeupLabel, seatLabel } from "@/lib/lesson-seat";
import { prisma } from "@/lib/prisma";

const weekdayNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export default async function TeacherSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string; week?: string; lesson?: string }>;
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
          course: { select: { id: true, name: true, billingType: true } },
          classGroup: { select: { capacity: true, name: true } },
          classroom: { select: { name: true, capacity: true } },
          teacher: { select: { name: true } },
          students: {
            include: {
              student: { select: { name: true, status: true, archiveReason: true, guardianPhone: true } },
              makeupSource: { select: { lessonSession: { select: { startAt: true } } } },
              makeups: { select: { id: true }, take: 1 },
            },
            orderBy: { student: { name: "asc" } },
          },
        },
        orderBy: { startAt: "asc" },
      })
    : [];
  const studentIds = [...new Set(lessons.flatMap((lesson) => lesson.students.map((row) => row.studentId)))];
  const courseIds = [...new Set(lessons.map((lesson) => lesson.courseId))];
  const [balances, courseEnrollments, makeupPool] = teacher
    ? await Promise.all([
        studentIds.length === 0 ? Promise.resolve([]) : prisma.courseHourBalance.findMany({
          where: { organizationId: user.organizationId, studentId: { in: studentIds }, courseId: { in: courseIds } },
          select: { studentId: true, courseId: true, remainingHours: true },
        }),
        studentIds.length === 0 ? Promise.resolve([]) : prisma.enrollment.findMany({
          where: { organizationId: user.organizationId, studentId: { in: studentIds }, courseId: { in: courseIds } },
          select: { studentId: true, courseId: true, startDate: true, endDate: true },
        }),
        prisma.lessonSession.findMany({
          where: { organizationId: user.organizationId, teacherId: teacher.id, status: { not: "CANCELLED" } },
          select: { id: true, courseId: true, title: true, startAt: true },
          orderBy: { startAt: "desc" },
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
  const now = new Date();
  const [colleagues, pendingChanges] = teacher
    ? await Promise.all([
        prisma.teacher.findMany({
          where: { organizationId: user.organizationId, status: "ACTIVE", id: { not: teacher.id } },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
        prisma.lessonChangeRequest.findMany({
          where: { organizationId: user.organizationId, status: "PENDING", lessonSession: { teacherId: teacher.id } },
          select: { id: true, lessonSessionId: true, kind: true, startAt: true, endAt: true, substituteTeacher: { select: { name: true } } },
        }),
      ])
    : [[], []];
  const pendingByLesson = new Map(pendingChanges.map((row) => [row.lessonSessionId, row]));
  function usageText(studentId: string, courseId: string, billingType: "PER_LESSON" | "PER_PERIOD") {
    const key = `${studentId}:${courseId}`;
    const enrolled = enrolledKeys.has(key);
    if (billingType === "PER_PERIOD") {
      const period = periodValidity(windows.get(key) ?? [], today);
      return formatCourseUsage({
        enrolled,
        billingType,
        periodStatus: enrolled ? period.status : null,
        remainingHours: null,
        validUntil: period.end === "—" ? null : period.end,
      }, today);
    }
    return formatCourseUsage({
      enrolled,
      billingType,
      periodStatus: null,
      remainingHours: enrolled ? hoursLeft.get(key) ?? 0 : null,
      validUntil: null,
    }, today);
  }

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
      openLessonId={params.lesson ?? ""}
      colleagues={colleagues}
      makeupOptions={makeupPool.map((lesson) => ({
        id: lesson.id,
        courseId: lesson.courseId,
        label: `${formatDateLabel(shanghaiDateKey(lesson.startAt))} ${formatClock(lesson.startAt)} ${lesson.title ?? "课次"}`,
      }))}
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
          billingType: lesson.course.billingType,
          canEditRoster: lesson.status !== "CANCELLED" && lesson.startAt > now,
          canRequestChange: lesson.status !== "CANCELLED" && lesson.startAt > now,
          changeRequest: (() => {
            const pending = pendingByLesson.get(lesson.id);
            if (!pending) return null;
            const summary = pending.kind === "RESCHEDULE" && pending.startAt && pending.endAt
              ? `调课待同意：改到 ${formatDateLabel(shanghaiDateKey(pending.startAt))} ${formatClock(pending.startAt)}–${formatClock(pending.endAt)}`
              : `代课待同意：${pending.substituteTeacher?.name ?? "另一位教师"}`;
            return { id: pending.id, summary };
          })(),
          teacherName: lesson.teacher.name,
          location: lesson.classroom?.name || lesson.location,
          status: lesson.status,
          classCapacity: lesson.classGroup.capacity,
          className: lesson.classGroup.name,
          roomCapacity: lesson.classroom?.capacity ?? null,
          overClassCapacity: lesson.classGroup.capacity != null && lesson.students.length > lesson.classGroup.capacity,
          overRoomCapacity: lesson.classroom?.capacity != null && lesson.students.length > lesson.classroom.capacity,
          students: lesson.students.map((row) => ({
            id: row.studentId,
            lessonStudentId: row.id,
            name: row.student.name,
            phone: row.student.guardianPhone,
            inactive: row.student.status !== "ACTIVE",
            archiveReason: row.student.archiveReason,
            attendanceStatus: row.attendanceStatus,
            leaveKind: row.leaveKind,
            attendanceNote: row.attendanceNote,
            parentLeave: row.parentLeaveAt != null,
            seat: row.seat,
            seatLabel: seatLabel[row.seat],
            makeupText: row.makeupSource ? makeupLabel(row.makeupSource.lessonSession.startAt) : null,
            usageText: usageText(row.studentId, lesson.courseId, lesson.course.billingType),
            canMakeup: lesson.status !== "CANCELLED" && row.attendanceStatus === "LEAVE" && row.makeups.length === 0 && row.student.status === "ACTIVE",
          })),
        };
      })}
    />
  );
}
