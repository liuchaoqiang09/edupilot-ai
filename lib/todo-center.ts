import { billingUsageLabel, needsBillingFollowUp } from "@/lib/billing-list";
import { classIsFull, distinctEnrolled } from "@/lib/class-occupancy";
import { calendarDateKey, periodValidity } from "@/lib/course-hours";
import { shanghaiDateKey } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";

export const todoGroups = ["renewal", "records", "reports", "trials", "waitlist"] as const;
export type TodoGroup = (typeof todoGroups)[number];

export function isTodoGroup(value: string | undefined): value is TodoGroup {
  return todoGroups.some((item) => item === value);
}

export function renewalTodoHref(key: string) {
  return `/owner/billing?focus=${encodeURIComponent(key)}`;
}

export function lessonTodoHref(lessonId: string, date: string) {
  return `/owner/schedule?view=day&date=${date}&lesson=${lessonId}`;
}

export function reportTodoHref(reportId: string) {
  return `/owner/reports?all=1&status=${encodeURIComponent("待确认")}&report=${reportId}`;
}

export function waitlistTodoHref(classId: string) {
  return `/owner/courses?class=${classId}`;
}

export async function ownerTodoLists(organizationId: string) {
  const now = new Date();
  const today = shanghaiDateKey(now);
  const todayStart = new Date(`${today}T00:00:00+08:00`);
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const [lessonEnrollments, balances, periodEnrollments, followUps, endedLessons, reports, trials, classes, classEnrollments, waits] = await Promise.all([
    prisma.enrollment.findMany({
      where: { organizationId, student: { status: "ACTIVE" }, course: { billingType: "PER_LESSON" } },
      select: { studentId: true, courseId: true, student: { select: { name: true } }, course: { select: { name: true } } },
    }),
    prisma.courseHourBalance.findMany({
      where: { organizationId, course: { billingType: "PER_LESSON" } },
      select: { studentId: true, courseId: true, remainingHours: true },
    }),
    prisma.enrollment.findMany({
      where: { organizationId, student: { status: "ACTIVE" }, course: { billingType: "PER_PERIOD" } },
      select: { studentId: true, courseId: true, startDate: true, endDate: true, student: { select: { name: true } }, course: { select: { name: true } } },
    }),
    prisma.renewalFollowUp.findMany({
      where: { organizationId },
      select: { studentId: true, courseId: true },
    }),
    prisma.lessonSession.findMany({
      where: { organizationId, status: { not: "CANCELLED" }, startAt: { gte: todayStart, lt: todayEnd }, endAt: { lte: now }, teachingRecord: { is: null } },
      orderBy: { endAt: "asc" },
      select: { id: true, title: true, startAt: true, endAt: true, course: { select: { name: true } }, teacher: { select: { name: true } } },
    }),
    prisma.teachingReport.findMany({
      where: { organizationId, status: { in: ["DRAFT", "CONFIRMED", "RETURNED"] } },
      orderBy: { updatedAt: "desc" },
      select: { id: true, status: true, student: { select: { name: true } }, lessonSession: { select: { title: true } } },
    }),
    prisma.lessonStudent.findMany({
      where: { organizationId, seat: "TRIAL", lessonSession: { status: { not: "CANCELLED" } } },
      orderBy: { lessonSession: { startAt: "asc" } },
      select: { id: true, student: { select: { name: true } }, lessonSession: { select: { id: true, title: true, startAt: true } } },
    }),
    prisma.classGroup.findMany({
      where: { organizationId, status: "ACTIVE" },
      select: { id: true, name: true, capacity: true, course: { select: { name: true } } },
    }),
    prisma.enrollment.findMany({
      where: { organizationId, classGroupId: { not: null }, student: { status: "ACTIVE" } },
      select: { classGroupId: true, studentId: true },
    }),
    prisma.classWaitlist.findMany({
      where: { organizationId },
      select: { classGroupId: true, student: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const followed = new Set(followUps.map((row) => `${row.studentId}:${row.courseId}`));
  const remaining = new Map(balances.map((row) => [`${row.studentId}:${row.courseId}`, row.remainingHours]));
  const renewals: { key: string; studentName: string; courseName: string; detail: string }[] = [];
  const seenLessons = new Set<string>();
  for (const row of lessonEnrollments) {
    const key = `${row.studentId}:${row.courseId}`;
    if (seenLessons.has(key) || followed.has(key)) continue;
    seenLessons.add(key);
    const usage = { enrolled: true, billingType: "PER_LESSON" as const, remainingHours: remaining.get(key) ?? 0, periodStatus: null, validUntil: null };
    if (!needsBillingFollowUp(usage, today)) continue;
    renewals.push({ key, studentName: row.student.name, courseName: row.course.name, detail: billingUsageLabel(usage, today) });
  }
  const windows = new Map<string, { studentName: string; courseName: string; ranges: { start: string; end: string }[] }>();
  for (const row of periodEnrollments) {
    const key = `${row.studentId}:${row.courseId}`;
    const current = windows.get(key) ?? { studentName: row.student.name, courseName: row.course.name, ranges: [] };
    if (row.startDate && row.endDate) current.ranges.push({ start: calendarDateKey(row.startDate), end: calendarDateKey(row.endDate) });
    windows.set(key, current);
  }
  for (const [key, item] of windows) {
    if (followed.has(key)) continue;
    const period = periodValidity(item.ranges, today);
    const usage = {
      enrolled: true,
      billingType: "PER_PERIOD" as const,
      remainingHours: null,
      periodStatus: period.status,
      validUntil: period.end === "—" ? null : period.end,
    };
    if (!needsBillingFollowUp(usage, today)) continue;
    renewals.push({ key, studentName: item.studentName, courseName: item.courseName, detail: billingUsageLabel(usage, today) });
  }

  const enrolled = distinctEnrolled(classEnrollments);
  const waitingNames = new Map<string, string[]>();
  for (const row of waits) {
    const list = waitingNames.get(row.classGroupId) ?? [];
    list.push(row.student.name);
    waitingNames.set(row.classGroupId, list);
  }
  const fullQueues = classes.flatMap((item) => {
    const count = enrolled.get(item.id)?.size ?? 0;
    const names = waitingNames.get(item.id) ?? [];
    if (!classIsFull(item.capacity, count) || names.length === 0) return [];
    return [{ id: item.id, name: item.name, courseName: item.course.name, enrolled: count, capacity: item.capacity ?? 0, waiting: names }];
  });

  return {
    renewals,
    records: endedLessons,
    reports,
    trials,
    fullQueues,
  };
}
