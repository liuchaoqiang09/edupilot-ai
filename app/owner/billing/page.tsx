import { OwnerBilling } from "@/components/owner-billing";
import { requireRole } from "@/lib/auth";
import { dayRange, shanghaiDateKey } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";

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

function yuan(value: { toString(): string } | null) {
  const amount = Number(value?.toString() ?? 0);
  return `¥ ${amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function OwnerBillingPage() {
  const user = await requireRole("OWNER", "owner");
  const month = monthRange(shanghaiDateKey());
  const [students, courses, thisMonth, lastMonth, income, review] = await Promise.all([
    prisma.student.findMany({
      where: { organizationId: user.organizationId, status: "ACTIVE" },
      orderBy: [{ remainingHours: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        grade: true,
        remainingHours: true,
        enrollments: { orderBy: { createdAt: "desc" }, select: { paidAt: true, createdAt: true, course: { select: { name: true } } } },
      },
    }),
    prisma.course.findMany({
      where: { organizationId: user.organizationId, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
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
  const renewing = students.filter((student) => student.enrollments.length > 0 && student.remainingHours < 8).length;

  return (
    <OwnerBilling
      courses={courses}
      stats={{ enrollments: thisMonth, compare, income: yuan(income._sum.amount), renewing, review }}
      students={students.map((student) => {
        const names = [...new Set(student.enrollments.map((row) => row.course.name))];
        const latest = student.enrollments.find((row) => row.paidAt) ?? student.enrollments[0];
        return {
          id: student.id,
          name: student.name,
          grade: student.grade,
          remainingHours: student.remainingHours,
          courses: names.join("、") || "还没有报名课程",
          lastPaid: latest?.paidAt ? latest.paidAt.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : "还没有缴费",
          enrolled: student.enrollments.length > 0,
          followUp: student.enrollments.length > 0 && student.remainingHours < 8,
        };
      })}
    />
  );
}
