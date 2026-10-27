import { billingStatusRank, billingUsageLabel, formatCourseUsage } from "@/lib/billing-list";
import { calendarDateKey, periodValidity } from "@/lib/course-hours";
import { shanghaiDateKey } from "@/lib/datetime";
import { arrearsCents, decimalCents } from "@/lib/enrollment-money";
import { prisma } from "@/lib/prisma";

export type ParentCourseCard = {
  key: string;
  studentName: string;
  inactive: boolean;
  courseName: string;
  enrolled: boolean;
  usage: string;
  arrearsCents: number;
  attention: boolean;
};

export function formatYuan(cents: number) {
  return (cents / 100).toFixed(2);
}

export async function parentCourseCards(organizationId: string, parentUserId: string): Promise<ParentCourseCard[]> {
  const links = await prisma.parentStudentLink.findMany({
    where: { organizationId, parentUserId },
    select: { student: { select: { id: true, name: true, status: true } } },
  });
  const students = links.map((link) => link.student);
  if (students.length === 0) return [];
  const studentIds = students.map((student) => student.id);
  const today = shanghaiDateKey();
  const [enrollments, balances, lessons] = await Promise.all([
    prisma.enrollment.findMany({
      where: { organizationId, studentId: { in: studentIds } },
      select: {
        studentId: true,
        courseId: true,
        amountDue: true,
        discountPercent: true,
        startDate: true,
        endDate: true,
        course: { select: { name: true, billingType: true } },
        payments: { where: { voidedAt: null }, select: { amount: true } },
      },
    }),
    prisma.courseHourBalance.findMany({
      where: { organizationId, studentId: { in: studentIds } },
      select: { studentId: true, courseId: true, remainingHours: true },
    }),
    prisma.lessonStudent.findMany({
      where: { organizationId, studentId: { in: studentIds }, lessonSession: { status: { not: "CANCELLED" } } },
      select: { studentId: true, lessonSession: { select: { courseId: true, course: { select: { name: true } } } } },
    }),
  ]);
  const hours = new Map(balances.map((row) => [`${row.studentId}:${row.courseId}`, row.remainingHours]));
  const grouped = new Map<string, typeof enrollments>();
  for (const row of enrollments) {
    const key = `${row.studentId}:${row.courseId}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  const studentById = new Map(students.map((student) => [student.id, student]));
  const cards: ParentCourseCard[] = [];
  for (const [key, rows] of grouped) {
    const first = rows[0];
    const student = studentById.get(first.studentId);
    if (!student) continue;
    const arrears = rows.reduce((sum, row) => {
      const due = decimalCents(row.amountDue);
      const net = row.payments.reduce((paid, payment) => paid + decimalCents(payment.amount), 0);
      const discount = row.discountPercent == null ? null : Number(row.discountPercent);
      return sum + arrearsCents(due, net, discount);
    }, 0);
    const windows = rows.flatMap((row) => row.startDate && row.endDate ? [{ start: calendarDateKey(row.startDate), end: calendarDateKey(row.endDate) }] : []);
    const period = first.course.billingType === "PER_PERIOD" ? periodValidity(windows, today) : null;
    const usageInput = {
      enrolled: true as const,
      billingType: first.course.billingType,
      remainingHours: first.course.billingType === "PER_LESSON" ? hours.get(key) ?? 0 : null,
      periodStatus: period?.status ?? null,
      validUntil: period && period.end !== "—" ? period.end : null,
    };
    const label = billingUsageLabel(usageInput, today);
    cards.push({
      key,
      studentName: student.name,
      inactive: student.status !== "ACTIVE",
      courseName: first.course.name,
      enrolled: true,
      usage: formatCourseUsage(usageInput, today),
      arrearsCents: arrears,
      attention: arrears > 0 || billingStatusRank(usageInput, today) < 5 || label === "未填写有效期",
    });
  }
  const seen = new Set(cards.map((card) => card.key));
  for (const row of lessons) {
    const key = `${row.studentId}:${row.lessonSession.courseId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const student = studentById.get(row.studentId);
    if (!student) continue;
    cards.push({
      key,
      studentName: student.name,
      inactive: student.status !== "ACTIVE",
      courseName: row.lessonSession.course.name,
      enrolled: false,
      usage: "已排课，还没有报名记录",
      arrearsCents: 0,
      attention: true,
    });
  }
  return cards.sort((left, right) => {
    if ((left.arrearsCents > 0) !== (right.arrearsCents > 0)) return left.arrearsCents > 0 ? -1 : 1;
    if (left.attention !== right.attention) return left.attention ? -1 : 1;
    return `${left.studentName}${left.courseName}`.localeCompare(`${right.studentName}${right.courseName}`, "zh");
  });
}
