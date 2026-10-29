import { ScheduleBoard, type ScheduleLesson } from "@/components/schedule-board";
import { requireRole } from "@/lib/auth";
import { dayRange, formatClock, formatDateLabel, formatMonthDay, parseDateKey, shanghaiDateKey, shanghaiMinutes, shiftDate, weekStartKey } from "@/lib/datetime";
import { normalizeRoom } from "@/lib/lesson-conflicts";
import { makeupLabel } from "@/lib/lesson-seat";
import { prisma } from "@/lib/prisma";
import { Pager, pageOf } from "@/components/pager";

const weekdayNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export default async function OwnerSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string; week?: string; status?: string; range?: string; page?: string; room?: string; lesson?: string; form?: string; open?: string }>;
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

  const [lessons, classes, teachers, rooms] = await Promise.all([
    prisma.lessonSession.findMany({
      where: lessonWhere,
      include: {
        course: { select: { id: true, name: true } },
        classGroup: { select: { name: true } },
        teacher: { select: { id: true, name: true } },
        teachingRecord: { select: { id: true } },
        classroom: { select: { id: true, name: true } },
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
            makeupSource: { select: { lessonSession: { select: { startAt: true } } } },
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
    prisma.classroom.findMany({
      where: { organizationId: user.organizationId },
      orderBy: [{ available: "desc" }, { name: "asc" }],
      select: { id: true, name: true, capacity: true, available: true },
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
      location: lesson.classroom?.name ?? lesson.location,
      classroomId: lesson.classroomId,
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
        leaveKind: row.leaveKind,
        attendanceNote: row.attendanceNote,
        lessonStudentId: row.id,
        seat: row.seat,
        makeupText: row.makeupSource ? makeupLabel(row.makeupSource.lessonSession.startAt) : null,
      })),
    };
  });

  const selectedRoom = rooms.find((room) => room.id === params.room) ?? null;
  const roomLessons = selectedRoom
    ? mapped.filter((lesson) => lesson.classroomId === selectedRoom.id || (!lesson.classroomId && normalizeRoom(lesson.location) === normalizeRoom(selectedRoom.name)))
    : mapped;
  const lessonId = params.lesson ?? "";
  const openedLesson = lessonId ? roomLessons.find((lesson) => lesson.id === lessonId) : null;
  const orderedLessons = openedLesson ? [openedLesson, ...roomLessons.filter((lesson) => lesson.id !== openedLesson.id)] : roomLessons;
  const window = pageOf(params.page, orderedLessons.length);
  const exportQuery = new URLSearchParams();
  if (params.date) exportQuery.set("date", params.date);
  if (params.view) exportQuery.set("view", params.view);
  if (params.week) exportQuery.set("week", params.week);
  if (params.status) exportQuery.set("status", params.status);
  if (params.range) exportQuery.set("range", params.range);
  if (selectedRoom) exportQuery.set("room", selectedRoom.id);
  function pageHref(page: number) {
    const query = new URLSearchParams(exportQuery);
    if (page > 1) query.set("page", String(page));
    const text = query.toString();
    return text ? `/owner/schedule?${text}` : "/owner/schedule";
  }

  return (
    <>
    <div className="mb-3 flex justify-end">
      <a href={`/owner/schedule/export?${exportQuery}`} className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold text-[#385058]">导出当前结果</a>
    </div>
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
      lessons={orderedLessons.slice(window.start, window.start + 20)}
      openLessonId={lessonId}
      openFormKey={params.form === "lesson" || params.form === "recurring" ? `${params.form}:${params.open ?? "1"}` : ""}
      rooms={rooms}
      roomId={selectedRoom?.id ?? ""}
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
    {window.pages > 1 ? (
      <div className="mt-3 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        <Pager page={window.page} pages={window.pages} href={pageHref} />
      </div>
    ) : null}
    </>
  );
}
