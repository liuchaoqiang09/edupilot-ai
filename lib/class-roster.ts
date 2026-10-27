import { calendarDateKey, periodValidity } from "@/lib/course-hours";
import { shanghaiDateKey } from "@/lib/datetime";
import { decimalCents, payableCents } from "@/lib/enrollment-money";
import { prisma } from "@/lib/prisma";
import type { RosterStudent } from "@/lib/roster-student";

export type { RosterStudent } from "@/lib/roster-student";

const enrollmentLabels = {
  PAID: "已缴费",
  PARTIAL: "部分缴费",
  UNPAID: "未缴费",
} as const;

export function enrollmentLabel(status: keyof typeof enrollmentLabels | null | undefined) {
  return status ? enrollmentLabels[status] : "未报名";
}

/// 本班学生：报名记录绑了这个班级，并且学员状态是在读。课时用完或已超过报名结束日期时标为欠费。
export async function classRoster(organizationId: string, classGroupId: string): Promise<RosterStudent[]> {
  const today = shanghaiDateKey();
  const rows = await prisma.enrollment.findMany({
    where: { organizationId, classGroupId, student: { status: "ACTIVE" } },
    select: {
      studentId: true,
      courseId: true,
      amountDue: true,
      discountPercent: true,
      amount: true,
      startDate: true,
      endDate: true,
      createdAt: true,
      course: { select: { billingType: true } },
      student: {
        select: {
          name: true,
          studentNo: true,
          grade: true,
          age: true,
          courseHourBalances: { select: { courseId: true, remainingHours: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const current = grouped.get(row.studentId) ?? [];
    current.push(row);
    grouped.set(row.studentId, current);
  }
  const students: RosterStudent[] = [];
  for (const enrollments of grouped.values()) {
    const latest = enrollments[0];
    const arrears = latest.course.billingType === "PER_LESSON"
      ? (latest.student.courseHourBalances.find((item) => item.courseId === latest.courseId)?.remainingHours ?? 0) === 0
      : periodValidity(
        enrollments.flatMap((enrollment) => enrollment.startDate && enrollment.endDate
          ? [{ start: calendarDateKey(enrollment.startDate), end: calendarDateKey(enrollment.endDate) }]
          : []),
        today,
      ).status === "已过期";
    let payable = 0;
    let received = 0;
    for (const enrollment of enrollments) {
      const due = decimalCents(enrollment.amountDue);
      const discount = enrollment.discountPercent == null ? null : Number(enrollment.discountPercent);
      payable += payableCents(due, discount);
      received += decimalCents(enrollment.amount);
    }
    const standing = received <= 0 ? (payable <= 0 ? "PAID" : "UNPAID") : received >= payable ? "PAID" : "PARTIAL";
    students.push({
      id: latest.studentId,
      name: latest.student.name,
      studentNo: latest.student.studentNo,
      grade: latest.student.grade,
      age: latest.student.age,
      enrollmentLabel: arrears ? "欠费" : enrollmentLabel(standing),
    });
  }
  return students.sort((left, right) => left.name.localeCompare(right.name, "zh"));
}
