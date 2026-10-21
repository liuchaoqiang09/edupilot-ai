import { dayRange, shanghaiDateKey, shiftDate } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import type { AttendanceStatus } from "@prisma/client";

const attendanceOrder: AttendanceStatus[] = ["PRESENT", "LATE", "LEAVE", "ABSENT", "NOT_MARKED"];

function windows(now = new Date()) {
  const today = shanghaiDateKey(now);
  const todayRange = dayRange(today);
  return {
    today,
    todayStart: todayRange.start,
    todayEnd: todayRange.end,
    upcomingEnd: dayRange(shiftDate(today, 7)).start,
    recentStart: dayRange(shiftDate(today, -6)).start,
  };
}

function tally(rows: { attendanceStatus: AttendanceStatus; _count: { _all: number } }[]) {
  const counts = Object.fromEntries(attendanceOrder.map((status) => [status, 0])) as Record<AttendanceStatus, number>;
  for (const row of rows) counts[row.attendanceStatus] = row._count._all;
  const total = attendanceOrder.reduce((sum, status) => sum + counts[status], 0);
  return { counts, total };
}

export async function ownerSnapshot(organizationId: string) {
  const time = windows();
  const org = { organizationId };
  const activeLesson = { organizationId, status: { not: "CANCELLED" as const } };
  const [
    activeStudents,
    inactiveStudents,
    activeTeachers,
    todayLessons,
    upcomingLessons,
    pendingRecords,
    pendingReports,
    attendanceRows,
    recentLessons,
  ] = await Promise.all([
    prisma.student.count({ where: { ...org, status: "ACTIVE" } }),
    prisma.student.count({ where: { ...org, status: "INACTIVE" } }),
    prisma.teacher.count({ where: { ...org, status: "ACTIVE" } }),
    prisma.lessonSession.count({ where: { ...activeLesson, startAt: { gte: time.todayStart, lt: time.todayEnd } } }),
    prisma.lessonSession.count({ where: { ...activeLesson, startAt: { gte: time.todayStart, lt: time.upcomingEnd } } }),
    prisma.lessonSession.count({ where: { ...activeLesson, endAt: { lt: new Date() }, teachingRecord: { is: null } } }),
    prisma.teachingReport.count({ where: { ...org, status: { in: ["DRAFT", "CONFIRMED", "RETURNED"] } } }),
    prisma.lessonStudent.groupBy({
      by: ["attendanceStatus"],
      where: { ...org, lessonSession: { startAt: { gte: time.recentStart, lt: time.todayEnd }, status: { not: "CANCELLED" } } },
      _count: { _all: true },
    }),
    prisma.lessonSession.findMany({
      where: activeLesson,
      orderBy: { startAt: "desc" },
      take: 5,
      select: {
        id: true,
        title: true,
        startAt: true,
        course: { select: { name: true } },
        teacher: { select: { name: true } },
        teachingRecord: { select: { id: true } },
      },
    }),
  ]);
  return {
    activeStudents,
    inactiveStudents,
    activeTeachers,
    todayLessons,
    upcomingLessons,
    pendingRecords,
    pendingReports,
    attendance: tally(attendanceRows),
    recentLessons,
  };
}

function monthBounds(todayKey: string) {
  const [yearText, monthText] = todayKey.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const startKey = `${yearText}-${monthText}-01`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const previousYear = month === 1 ? year - 1 : year;
  const previousMonth = month === 1 ? 12 : month - 1;
  return {
    start: dayRange(startKey).start,
    end: dayRange(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01`).start,
    previousStart: dayRange(`${previousYear}-${String(previousMonth).padStart(2, "0")}-01`).start,
  };
}

function percent(part: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

export async function ownerOverview(organizationId: string) {
  const time = windows();
  const month = monthBounds(time.today);
  const todayWhere = {
    organizationId,
    status: { not: "CANCELLED" as const },
    startAt: { gte: time.todayStart, lt: time.todayEnd },
  };
  const [activeStudents, newStudents, enrollmentsThisMonth, enrollmentsLastMonth, lessons, pendingReports, pendingReportRows, renewingCount] = await Promise.all([
    prisma.student.count({ where: { organizationId, status: "ACTIVE" } }),
    prisma.student.count({ where: { organizationId, createdAt: { gte: month.start, lt: month.end } } }),
    prisma.enrollment.findMany({
      where: { organizationId, createdAt: { gte: month.start, lt: month.end } },
      select: { createdAt: true },
    }),
    prisma.enrollment.count({ where: { organizationId, createdAt: { gte: month.previousStart, lt: month.start } } }),
    prisma.lessonSession.findMany({
      where: todayWhere,
      orderBy: { startAt: "asc" },
      select: {
        id: true,
        title: true,
        startAt: true,
        endAt: true,
        location: true,
        course: { select: { name: true } },
        teacher: { select: { name: true } },
        teachingRecord: { select: { id: true } },
        _count: { select: { students: true, reports: true } },
        reports: { where: { status: "PUBLISHED" }, select: { id: true } },
      },
    }),
    prisma.teachingReport.count({ where: { organizationId, status: { in: ["DRAFT", "CONFIRMED", "RETURNED"] } } }),
    prisma.teachingReport.findMany({
      where: { organizationId, status: { in: ["DRAFT", "CONFIRMED", "RETURNED"] } },
      orderBy: { updatedAt: "desc" },
      take: 8,
      select: { student: { select: { name: true } } },
    }),
    prisma.student.count({
      where: { organizationId, status: "ACTIVE", remainingHours: { lt: 8 }, enrollments: { some: {} } },
    }),
  ]);

  const lessonCount = lessons.length;
  const recorded = lessons.filter((lesson) => lesson.teachingRecord).length;
  const expectedReports = lessons.reduce((sum, lesson) => sum + lesson._count.students, 0);
  const generatedReports = lessons.reduce((sum, lesson) => sum + lesson._count.reports, 0);
  const publishedReports = lessons.reduce((sum, lesson) => sum + lesson.reports.length, 0);
  const weeks = [
    { label: "1–7日", from: 1, to: 7 },
    { label: "8–14日", from: 8, to: 14 },
    { label: "15–21日", from: 15, to: 21 },
    { label: "22日后", from: 22, to: 31 },
  ].map((week) => ({
    label: week.label,
    count: enrollmentsThisMonth.filter((row) => {
      const day = Number(shanghaiDateKey(row.createdAt).slice(8, 10));
      return day >= week.from && day <= week.to;
    }).length,
  }));
  const todayNumber = Number(time.today.slice(8, 10));
  const currentWeek = todayNumber <= 7 ? 0 : todayNumber <= 14 ? 1 : todayNumber <= 21 ? 2 : 3;

  return {
    activeStudents,
    newStudents,
    enrollmentsThisMonth: enrollmentsThisMonth.length,
    enrollmentsLastMonth,
    lessons,
    missingRecords: lessonCount - recorded,
    pendingReports,
    renewingCount,
    pendingNames: [...new Set(pendingReportRows.map((row) => row.student.name))],
    rates: {
      recorded: percent(recorded, lessonCount),
      generated: percent(generatedReports, expectedReports),
      published: percent(publishedReports, expectedReports),
      lessonCount,
      expectedReports,
    },
    weeks,
    currentWeek,
    todayKey: time.today,
  };
}

export async function teacherSnapshot(organizationId: string, teacherId: string | null) {
  if (!teacherId) {
    return { todayLessons: 0, pendingRecordCount: 0, pendingRecords: [] as PendingLesson[], pendingReports: 0, published: [] as PublishedBrief[] };
  }
  const time = windows();
  const mine = { organizationId, teacherId, status: { not: "CANCELLED" as const } };
  const pendingWhere = { ...mine, endAt: { lt: new Date() }, teachingRecord: { is: null } };
  const [todayLessons, pendingRecordCount, pendingRecords, pendingReports, published] = await Promise.all([
    prisma.lessonSession.count({ where: { ...mine, startAt: { gte: time.todayStart, lt: time.todayEnd } } }),
    prisma.lessonSession.count({ where: pendingWhere }),
    prisma.lessonSession.findMany({
      where: pendingWhere,
      orderBy: { startAt: "desc" },
      take: 5,
      select: { id: true, title: true, startAt: true, course: { select: { name: true } } },
    }),
    prisma.teachingReport.count({
      where: { organizationId, status: { in: ["DRAFT", "RETURNED"] }, lessonSession: { teacherId } },
    }),
    prisma.teachingReport.findMany({
      where: { organizationId, status: "PUBLISHED", lessonSession: { teacherId } },
      orderBy: { publishedAt: "desc" },
      take: 3,
      select: {
        id: true,
        publishedAt: true,
        student: { select: { name: true } },
        lessonSession: { select: { title: true, course: { select: { name: true } } } },
      },
    }),
  ]);
  return { todayLessons, pendingRecordCount, pendingRecords, pendingReports, published };
}

type PendingLesson = { id: string; title: string | null; startAt: Date; course: { name: string } };
type PublishedBrief = {
  id: string;
  publishedAt: Date | null;
  student: { name: string };
  lessonSession: { title: string | null; course: { name: string } };
};

export async function parentSnapshot(organizationId: string, parentUserId: string) {
  const links = await prisma.parentStudentLink.findMany({
    where: { organizationId, parentUserId },
    include: { student: { select: { id: true, name: true, grade: true, studentNo: true, status: true } } },
    orderBy: { createdAt: "desc" },
  });
  const studentIds = links.map((link) => link.student.id);
  if (studentIds.length === 0) {
    return { links, upcoming: [], reports: [], attendance: tally([]) };
  }
  const time = windows();
  const [upcoming, reports, attendanceRows] = await Promise.all([
    prisma.lessonStudent.findMany({
      where: {
        organizationId,
        studentId: { in: studentIds },
        lessonSession: { status: { not: "CANCELLED" }, startAt: { gte: time.todayStart, lt: time.upcomingEnd } },
      },
      orderBy: { lessonSession: { startAt: "asc" } },
      take: 6,
      select: {
        id: true,
        attendanceStatus: true,
        student: { select: { name: true } },
        lessonSession: { select: { title: true, startAt: true, endAt: true, location: true, course: { select: { name: true } } } },
      },
    }),
    prisma.teachingReport.findMany({
      where: { organizationId, studentId: { in: studentIds }, status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
      take: 3,
      select: {
        id: true,
        summary: true,
        publishedAt: true,
        student: { select: { name: true } },
        lessonSession: { select: { title: true, course: { select: { name: true } } } },
      },
    }),
    prisma.lessonStudent.groupBy({
      by: ["attendanceStatus"],
      where: {
        organizationId,
        studentId: { in: studentIds },
        lessonSession: { startAt: { gte: time.recentStart, lt: time.todayEnd }, status: { not: "CANCELLED" } },
      },
      _count: { _all: true },
    }),
  ]);
  return { links, upcoming, reports, attendance: tally(attendanceRows) };
}
