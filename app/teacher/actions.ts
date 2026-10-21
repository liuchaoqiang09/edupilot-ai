"use server";

import { revalidatePath } from "next/cache";
import { AttendanceStatus } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { attendanceOptions } from "@/lib/lesson-labels";
import { prisma } from "@/lib/prisma";

export type ActionResult = { ok: boolean; message?: string };

const statuses = new Set<string>(attendanceOptions);

export async function saveAttendance(lessonId: string, formData: FormData): Promise<ActionResult> {
  const user = await requireRole("TEACHER", "teacher");
  const teacher = await prisma.teacher.findFirst({
    where: { userId: user.id, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!teacher) return { ok: false, message: "当前账号还没有关联在职教师档案。" };

  const lesson = await prisma.lessonSession.findFirst({
    where: { id: lessonId, organizationId: user.organizationId, teacherId: teacher.id, status: { not: "CANCELLED" } },
    select: { id: true, students: { select: { id: true, studentId: true } } },
  });
  if (!lesson) return { ok: false, message: "这节课不存在，或你无权记录考勤。" };

  const updates = lesson.students.map((row) => {
    const status = String(formData.get(`status:${row.studentId}`) ?? "");
    const note = String(formData.get(`note:${row.studentId}`) ?? "").trim();
    return { id: row.id, status, note };
  });
  if (updates.some((row) => !statuses.has(row.status))) return { ok: false, message: "考勤状态无效。" };
  if (updates.some((row) => row.note.length > 80)) return { ok: false, message: "备注不能超过 80 个字。" };

  await prisma.$transaction(
    updates.map((row) =>
      prisma.lessonStudent.updateMany({
        where: { id: row.id, organizationId: user.organizationId, lessonSessionId: lesson.id },
        data: {
          attendanceStatus: row.status as AttendanceStatus,
          attendanceNote: row.note || null,
          lastAction: "更新考勤",
        },
      }),
    ),
  );

  revalidatePath("/teacher");
  revalidatePath("/owner/schedule");
  revalidatePath("/parent/schedule");
  revalidatePath("/parent/attendance");
  return { ok: true };
}
