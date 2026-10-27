import type { AttendanceStatus, Prisma } from "@prisma/client";
import { csvResponse } from "@/lib/csv";
import { requireRole } from "@/lib/auth";
import { dayRange, formatClock, formatDateLabel, shanghaiDateKey, shiftDate } from "@/lib/datetime";
import { attendanceLabel } from "@/lib/lesson-labels";
import { prisma } from "@/lib/prisma";
import { readSort } from "@/lib/table-sort";

function statusFromLabel(label: string | null) {
  const match = (Object.entries(attendanceLabel) as Array<[AttendanceStatus, string]>).find(([, text]) => text === label);
  return match?.[0] ?? null;
}

export async function GET(request: Request) {
  const user = await requireRole("OWNER", "owner");
  const params = new URL(request.url).searchParams;
  const status = statusFromLabel(params.get("status"));
  const sort = readSort(params.get("sortBy") ?? undefined, params.get("order") ?? undefined, ["date"] as const);
  const today = shanghaiDateKey();
  const orderBy: Prisma.LessonStudentOrderByWithRelationInput[] = [
    { lessonSession: { startAt: sort?.order ?? "desc" } },
    { student: { name: "asc" } },
  ];
  const rows = await prisma.lessonStudent.findMany({
    where: {
      organizationId: user.organizationId,
      ...(status ? { attendanceStatus: status } : {}),
      lessonSession: { startAt: { gte: dayRange(shiftDate(today, -6)).start, lt: dayRange(today).end }, status: { not: "CANCELLED" } },
    },
    select: {
      attendanceStatus: true,
      attendanceNote: true,
      student: { select: { name: true, studentNo: true } },
      lessonSession: { select: { startAt: true, course: { select: { name: true } }, teacher: { select: { name: true } } } },
    },
    orderBy,
  });
  const body: Array<Array<string | number | null>> = [["日期", "时间", "课程", "教师", "学生", "编号", "考勤", "备注"]];
  for (const row of rows) {
    const key = shanghaiDateKey(row.lessonSession.startAt);
    body.push([
      formatDateLabel(key),
      formatClock(row.lessonSession.startAt),
      row.lessonSession.course.name,
      row.lessonSession.teacher.name,
      row.student.name,
      row.student.studentNo,
      attendanceLabel[row.attendanceStatus],
      row.attendanceNote,
    ]);
  }
  return csvResponse("attendance.csv", body);
}
