"use server";

import { revalidatePath } from "next/cache";
import { AttendanceStatus } from "@prisma/client";
import { CourseHourError, syncAttendanceCharge } from "@/lib/course-hours";
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
    select: {
      id: true,
      courseId: true,
      course: { select: { name: true, billingType: true } },
      students: { select: { id: true, studentId: true, student: { select: { name: true } } } },
    },
  });
  if (!lesson) return { ok: false, message: "这节课不存在，或你无权记录考勤。" };

  const updates = lesson.students.map((row) => {
    const status = String(formData.get(`status:${row.studentId}`) ?? "");
    const note = String(formData.get(`note:${row.studentId}`) ?? "").trim();
    return { ...row, status, note };
  });
  if (updates.some((row) => !statuses.has(row.status))) return { ok: false, message: "考勤状态无效。" };
  if (updates.some((row) => row.note.length > 80)) return { ok: false, message: "备注不能超过 80 个字。" };

  const charged = new Set(["PRESENT", "LATE"]);
  try {
    await prisma.$transaction(async (tx) => {
      for (const row of updates) {
        await syncAttendanceCharge(tx, {
          organizationId: user.organizationId,
          lessonStudentId: row.id,
          studentId: row.studentId,
          studentName: row.student.name,
          courseId: lesson.courseId,
          courseName: lesson.course.name,
          billingType: lesson.course.billingType,
          shouldCharge: charged.has(row.status),
          attendanceStatus: row.status as AttendanceStatus,
          attendanceNote: row.note || null,
        });
      }
    });
  } catch (error) {
    if (error instanceof CourseHourError) return { ok: false, message: error.message };
    throw error;
  }

  revalidatePath("/teacher");
  revalidatePath("/owner/schedule");
  revalidatePath("/owner/billing");
  revalidatePath("/parent/schedule");
  revalidatePath("/parent/attendance");
  return { ok: true };
}
