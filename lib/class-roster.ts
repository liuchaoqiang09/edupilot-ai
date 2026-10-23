import { prisma } from "@/lib/prisma";
import type { RosterStudent } from "@/lib/roster-student";

export type { RosterStudent } from "@/lib/roster-student";

const enrollmentLabels = {
  PAID: "已缴清",
  PARTIAL: "部分缴费",
  UNPAID: "未缴费",
} as const;

export function enrollmentLabel(status: keyof typeof enrollmentLabels | null | undefined) {
  return status ? enrollmentLabels[status] : "未报名";
}

/// 本班学生：报名记录绑了这个班级，并且学员状态是在读。
export async function classRoster(organizationId: string, classGroupId: string): Promise<RosterStudent[]> {
  const rows = await prisma.enrollment.findMany({
    where: { organizationId, classGroupId, student: { status: "ACTIVE" } },
    select: {
      studentId: true,
      status: true,
      createdAt: true,
      student: { select: { name: true, grade: true, age: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const seen = new Map<string, RosterStudent>();
  for (const row of rows) {
    if (seen.has(row.studentId)) continue;
    seen.set(row.studentId, {
      id: row.studentId,
      name: row.student.name,
      grade: row.student.grade,
      age: row.student.age,
      enrollmentLabel: enrollmentLabel(row.status),
    });
  }
  return [...seen.values()].sort((left, right) => left.name.localeCompare(right.name, "zh"));
}
