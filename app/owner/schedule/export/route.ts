import { csvResponse } from "@/lib/csv";
import { requireRole } from "@/lib/auth";
import { dayRange, formatClock, formatDateLabel, parseDateKey, shanghaiDateKey, shiftDate, weekStartKey } from "@/lib/datetime";
import { normalizeRoom } from "@/lib/lesson-conflicts";
import { seatLabel } from "@/lib/lesson-seat";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const user = await requireRole("OWNER", "owner");
  const params = new URL(request.url).searchParams;
  const next7Days = params.get("range") === "next7days";
  const view = next7Days ? "day" : params.get("view") === "week" ? "week" : "day";
  const pendingRecords = !next7Days && view === "day" && params.get("status") === "待填写";
  const pendingAll = pendingRecords && !params.get("date");
  const date = parseDateKey(params.get("date") ?? undefined);
  const today = shanghaiDateKey();
  const currentWeek = weekStartKey(today);
  const earliestWeek = shiftDate(currentWeek, -14);
  const requestedWeek = weekStartKey(parseDateKey(params.get("week") ?? date));
  const weekStart = requestedWeek < earliestWeek ? earliestWeek : requestedWeek;
  const range = view === "week"
    ? { start: dayRange(weekStart).start, end: dayRange(shiftDate(weekStart, 7)).start }
    : dayRange(date);
  const now = new Date();
  const next7Range = { start: dayRange(today).start, end: dayRange(shiftDate(today, 7)).start };
  const lessons = await prisma.lessonSession.findMany({
    where: pendingAll
      ? { organizationId: user.organizationId, status: { not: "CANCELLED" }, endAt: { lte: now }, teachingRecord: { is: null } }
      : next7Days
        ? { organizationId: user.organizationId, status: { not: "CANCELLED" }, startAt: { gte: next7Range.start, lt: next7Range.end } }
        : { organizationId: user.organizationId, startAt: { gte: range.start, lt: range.end } },
    orderBy: { startAt: pendingAll ? "desc" : "asc" },
    select: {
      title: true,
      startAt: true,
      endAt: true,
      location: true,
      classroomId: true,
      classroom: { select: { name: true } },
      status: true,
      teachingRecord: { select: { id: true } },
      course: { select: { name: true } },
      classGroup: { select: { name: true } },
      teacher: { select: { name: true } },
      students: { select: { seat: true, student: { select: { name: true } } } },
    },
  });
  const roomId = params.get("room");
  const room = roomId
    ? await prisma.classroom.findFirst({ where: { id: roomId, organizationId: user.organizationId }, select: { id: true, name: true } })
    : null;
  const matched = room
    ? lessons.filter((lesson) => lesson.classroomId === room.id || (!lesson.classroomId && normalizeRoom(lesson.classroom?.name ?? lesson.location) === normalizeRoom(room.name)))
    : lessons;
  const visible = pendingRecords && !pendingAll
    ? matched.filter((lesson) => lesson.status !== "CANCELLED" && !lesson.teachingRecord && lesson.endAt <= now)
    : matched;
  const rows: Array<Array<string | number | null>> = [["日期", "开始", "结束", "课程", "班级", "教师", "地点", "状态", "学生"]];
  for (const lesson of visible) {
    const key = shanghaiDateKey(lesson.startAt);
    rows.push([
      formatDateLabel(key),
      formatClock(lesson.startAt),
      formatClock(lesson.endAt),
      lesson.course.name,
      lesson.classGroup.name,
      lesson.teacher.name,
      lesson.classroom?.name ?? lesson.location,
      lesson.status,
      lesson.students.map((row) => `${row.student.name}（${seatLabel[row.seat]}）`).join("、"),
    ]);
  }
  return csvResponse("schedule.csv", rows);
}
