import { OwnerBilling, type BillingStudent } from "@/components/owner-billing";
import { lowHourThreshold } from "@/lib/course-hours";
import { requireRole } from "@/lib/auth";
import { dayRange, shanghaiDateKey } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { readSort } from "@/lib/table-sort";

const billingSortFields = ["name", "course"] as const;

function monthRange(todayKey: string) {
  const [yearText, monthText] = todayKey.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const previousYear = month === 1 ? year - 1 : year;
  const previousMonth = month === 1 ? 12 : month - 1;
  return {
    start: dayRange(`${yearText}-${monthText}-01`).start,
    end: dayRange(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01`).start,
    previousStart: dayRange(`${previousYear}-${String(previousMonth).padStart(2, "0")}-01`).start,
  };
}

function utcDateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function periodState(windows: { start: string; end: string }[], today: string) {
  const active = windows.filter((window) => window.start <= today && today <= window.end).sort((left, right) => right.end.localeCompare(left.end))[0];
  if (active) return { end: active.end, status: "有效中" as const };
  const latest = [...windows].sort((left, right) => right.end.localeCompare(left.end))[0];
  if (!latest) return { end: "—", status: "已过期" as const };
  return { end: latest.end, status: latest.end < today ? "已过期" as const : "未开始" as const };
}

function yuan(value: { toString(): string } | null) {
  const amount = Number(value?.toString() ?? 0);
  return `¥ ${amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function orderBillingRows(rows: BillingStudent[], courseNames: string[]) {
  const groups = new Map<string, BillingStudent[]>();
  for (const row of rows) {
    const list = groups.get(row.courseName) ?? [];
    list.push(row);
    groups.set(row.courseName, list);
  }
  const ordered: BillingStudent[] = [];
  for (const name of courseNames) {
    const list = groups.get(name);
    if (!list) continue;
    ordered.push(...list);
    groups.delete(name);
  }
  for (const list of groups.values()) ordered.push(...list);
  return ordered;
}

export default async function OwnerBillingPage({
  searchParams,
}: {
  searchParams: Promise<{ sortBy?: string | string[]; order?: string | string[] }>;
}) {
  const user = await requireRole("OWNER", "owner");
  const params = await searchParams;
  const sort = readSort(params.sortBy, params.order, billingSortFields);
  const month = monthRange(shanghaiDateKey());
  const [students, courses, thisMonth, lastMonth, income, review] = await Promise.all([
    prisma.student.findMany({
      where: { organizationId: user.organizationId, status: "ACTIVE" },
      orderBy: { name: sort?.sortBy === "name" ? sort.order : "asc" },
      select: {
        id: true,
        name: true,
        grade: true,
        enrollments: {
          orderBy: { createdAt: "desc" },
          select: {
            courseId: true,
            paidAt: true,
            createdAt: true,
            startDate: true,
            endDate: true,
            course: { select: { name: true, billingType: true } },
          },
        },
        courseHourBalances: { select: { courseId: true, remainingHours: true } },
      },
    }),
    prisma.course.findMany({
      where: { organizationId: user.organizationId, status: "ACTIVE" },
      orderBy: { name: sort?.sortBy === "course" ? sort.order : "asc" },
      select: { id: true, name: true, billingType: true },
    }),
    prisma.enrollment.count({ where: { organizationId: user.organizationId, createdAt: { gte: month.start, lt: month.end } } }),
    prisma.enrollment.count({ where: { organizationId: user.organizationId, createdAt: { gte: month.previousStart, lt: month.start } } }),
    prisma.enrollment.aggregate({
      where: { organizationId: user.organizationId, paidAt: { gte: month.start, lt: month.end } },
      _sum: { amount: true },
    }),
    prisma.lessonStudent.count({
      where: {
        organizationId: user.organizationId,
        attendanceStatus: { in: ["ABSENT", "LEAVE"] },
        hoursCharged: false,
        lessonSession: { startAt: { gte: month.start, lt: month.end }, status: { not: "CANCELLED" } },
      },
    }),
  ]);
  const compare = lastMonth === 0 ? (thisMonth === 0 ? "上月也是 0" : "上月为 0") : `${Math.round(((thisMonth - lastMonth) / lastMonth) * 1000) / 10 > 0 ? "+" : ""}${Math.round(((thisMonth - lastMonth) / lastMonth) * 1000) / 10}% 较上月`;
  const today = shanghaiDateKey();
  const rows: BillingStudent[] = [];
  for (const student of students) {
    const byCourse = new Map<string, { name: string; billingType: "PER_LESSON" | "PER_PERIOD"; paidAt: Date | null; windows: { start: string; end: string }[] }>();
    for (const enrollment of student.enrollments) {
      const current = byCourse.get(enrollment.courseId) ?? {
        name: enrollment.course.name,
        billingType: enrollment.course.billingType,
        paidAt: enrollment.paidAt,
        windows: [],
      };
      if (enrollment.startDate && enrollment.endDate) {
        current.windows.push({ start: utcDateKey(enrollment.startDate), end: utcDateKey(enrollment.endDate) });
      }
      byCourse.set(enrollment.courseId, current);
    }
    if (byCourse.size === 0) {
      rows.push({
        rowKey: student.id,
        id: student.id,
        name: student.name,
        grade: student.grade,
        courseName: "还没有报名课程",
        usage: "—",
        usageStatus: "未报名",
        lastPaid: "还没有缴费",
        enrolled: false,
        followUp: false,
      });
      continue;
    }
    for (const [courseId, course] of byCourse) {
      const period = course.billingType === "PER_PERIOD" ? periodState(course.windows, today) : null;
      const remainingHours = student.courseHourBalances.find((item) => item.courseId === courseId)?.remainingHours ?? 0;
      const lowHours = remainingHours < lowHourThreshold;
      rows.push({
        rowKey: `${student.id}:${courseId}`,
        id: student.id,
        name: student.name,
        grade: student.grade,
        courseName: course.name,
        usage: period ? `有效期至 ${period.end}` : `剩余 ${remainingHours} 节`,
        usageStatus: period ? period.status : lowHours ? "课时不足" : "正常",
        lastPaid: course.paidAt ? course.paidAt.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : "还没有缴费",
        enrolled: true,
        followUp: period ? period.status === "已过期" : lowHours,
      });
    }
  }
  const renewing = new Set(rows.filter((row) => row.followUp).map((row) => row.id)).size;
  const tableRows = sort?.sortBy === "course" ? orderBillingRows(rows, courses.map((course) => course.name)) : rows;
  const formCourses = sort?.sortBy === "course" && sort.order === "desc" ? [...courses].reverse() : courses;

  return (
    <OwnerBilling
      courses={formCourses}
      sortBy={sort?.sortBy ?? null}
      order={sort?.order ?? null}
      stats={{ enrollments: thisMonth, compare, income: yuan(income._sum.amount), renewing, review }}
      students={tableRows}
    />
  );
}
