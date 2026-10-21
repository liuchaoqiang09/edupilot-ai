"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { CourseHourError, releaseChargedHour } from "@/lib/course-hours";
import { requireRole } from "@/lib/auth";
import { formatDateTime, parseShanghaiDateTime } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";

export type FieldErrors = Partial<Record<"classGroupId" | "teacherId" | "startAt" | "endAt" | "location" | "students", string>>;

export type ActionResult = {
  ok: boolean;
  message?: string;
  warning?: string;
  fieldErrors?: FieldErrors;
};

function clean(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function refresh() {
  revalidatePath("/owner/schedule");
  revalidatePath("/teacher");
  revalidatePath("/parent/schedule");
  revalidatePath("/parent/attendance");
  revalidatePath("/owner/billing");
}

function overlapMessage(lesson: { title: string | null; startAt: Date }) {
  const name = lesson.title ?? "未命名课次";
  return `这位教师在 ${formatDateTime(lesson.startAt)} 已有课次「${name}」。再次点击保存仍会继续，请确认是否冲突。`;
}

async function teacherOverlap(organizationId: string, teacherId: string, startAt: Date, endAt: Date, excludeLessonId?: string) {
  return prisma.lessonSession.findFirst({
    where: {
      organizationId,
      teacherId,
      status: { not: "CANCELLED" },
      ...(excludeLessonId ? { id: { not: excludeLessonId } } : {}),
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
    select: { title: true, startAt: true },
  });
}

export async function createLesson(formData: FormData): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  const fieldErrors: FieldErrors = {};
  const classGroupId = clean(formData.get("classGroupId"));
  const teacherId = clean(formData.get("teacherId"));
  const startAt = parseShanghaiDateTime(clean(formData.get("startAt")));
  const endAt = parseShanghaiDateTime(clean(formData.get("endAt")));
  const location = clean(formData.get("location"));
  const studentIds = [...new Set(formData.getAll("studentIds").filter((value): value is string => typeof value === "string" && value.length > 0))];

  if (!classGroupId) fieldErrors.classGroupId = "请选择班级。";
  if (!teacherId) fieldErrors.teacherId = "请选择教师。";
  if (!startAt) fieldErrors.startAt = "请填写开始时间。";
  if (!endAt) fieldErrors.endAt = "请填写结束时间。";
  else if (startAt && endAt <= startAt) fieldErrors.endAt = "结束时间必须晚于开始时间。";
  if (location.length > 40) fieldErrors.location = "地点不能超过 40 个字。";
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  const classGroup = await prisma.classGroup.findFirst({
    where: { id: classGroupId, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true, courseId: true, name: true, course: { select: { name: true } } },
  });
  if (!classGroup) return { ok: false, fieldErrors: { classGroupId: "只能选择本机构启用中的班级。" } };

  const teacher = await prisma.teacher.findFirst({
    where: { id: teacherId, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true, userId: true },
  });
  if (!teacher) return { ok: false, fieldErrors: { teacherId: "只能选择本机构的在职教师。" } };

  const students = studentIds.length
    ? await prisma.student.findMany({
        where: { id: { in: studentIds }, organizationId: user.organizationId, status: "ACTIVE" },
        select: { id: true },
      })
    : [];
  if (students.length !== studentIds.length) {
    return { ok: false, fieldErrors: { students: "名单里有不属于本机构或已停用的学生。" } };
  }

  const overlap = await teacherOverlap(user.organizationId, teacher.id, startAt!, endAt!);
  if (overlap && formData.get("acknowledgeConflict") !== "1") {
    return { ok: false, warning: overlapMessage(overlap) };
  }

  await prisma.lessonSession.create({
    data: {
      organizationId: user.organizationId,
      classGroupId: classGroup.id,
      courseId: classGroup.courseId,
      teacherId: teacher.id,
      title: `${classGroup.course.name} · ${classGroup.name}`,
      startAt: startAt!,
      endAt: endAt!,
      location: location || null,
      createdById: user.id,
      students: {
        create: students.map((student) => ({
          organizationId: user.organizationId,
          studentId: student.id,
          lastAction: "加入课次",
        })),
      },
    },
  });

  refresh();
  return {
    ok: true,
    warning: overlap
      ? "课次已保存。这位教师在同一时间还有另一节未取消的课。"
      : teacher.userId
        ? undefined
        : "课次已保存。这位教师还没有关联登录账号，教师端暂时看不到这节课。",
  };
}

export async function updateLessonTeacher(lessonId: string, formData: FormData): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  const teacherId = clean(formData.get("teacherId"));
  if (!teacherId) return { ok: false, fieldErrors: { teacherId: "请选择教师。" } };

  const lesson = await prisma.lessonSession.findFirst({
    where: { id: lessonId, organizationId: user.organizationId, status: { not: "CANCELLED" } },
    select: { id: true, teacherId: true, startAt: true, endAt: true },
  });
  if (!lesson) return { ok: false, message: "这节课不存在，或已经取消。" };

  const teacher = await prisma.teacher.findFirst({
    where: { id: teacherId, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true, userId: true },
  });
  if (!teacher) return { ok: false, fieldErrors: { teacherId: "只能选择本机构的在职教师。" } };
  if (teacher.id === lesson.teacherId) return { ok: true };

  const overlap = await teacherOverlap(user.organizationId, teacher.id, lesson.startAt, lesson.endAt, lesson.id);
  if (overlap && formData.get("acknowledgeConflict") !== "1") {
    return { ok: false, warning: overlapMessage(overlap) };
  }

  const updated = await prisma.lessonSession.updateMany({
    where: { id: lesson.id, organizationId: user.organizationId, status: { not: "CANCELLED" } },
    data: { teacherId: teacher.id },
  });
  if (updated.count !== 1) return { ok: false, message: "教师没有更换，请刷新后再试。" };

  refresh();
  return {
    ok: true,
    warning: overlap
      ? "教师已更换。这位教师在同一时间还有另一节未取消的课。"
      : teacher.userId
        ? undefined
        : "教师已更换。这位教师还没有关联登录账号，教师端暂时看不到这节课。",
  };
}

export async function removeLessonStudent(lessonId: string, studentId: string): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  const row = await prisma.lessonStudent.findFirst({
    where: { lessonSessionId: lessonId, studentId, organizationId: user.organizationId, lessonSession: { status: { not: "CANCELLED" } } },
    select: { id: true, lessonSession: { select: { courseId: true } } },
  });
  if (!row) return { ok: false, message: "名单里没有这名学生，或这节课已经取消。" };

  try {
    await prisma.$transaction(async (tx) => {
      const refunded = await releaseChargedHour(tx, {
        organizationId: user.organizationId,
        lessonStudentId: row.id,
        studentId,
        courseId: row.lessonSession.courseId,
      });
      const deleted = await tx.lessonStudent.deleteMany({
        where: { id: row.id, organizationId: user.organizationId, lessonSessionId: lessonId },
      });
      if (deleted.count !== 1) throw new CourseHourError("名单里没有这名学生，或这节课已经取消。");
      await writeAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "ROSTER_REMOVED",
        targetType: "LessonStudent",
        targetId: row.id,
        detail: refunded ? "移出课次名单，并退回该课程 1 课时" : "移出课次名单",
      });
    });
  } catch (error) {
    if (error instanceof CourseHourError) return { ok: false, message: error.message };
    throw error;
  }

  refresh();
  return { ok: true };
}

export async function cancelLesson(id: string): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  const updated = await prisma.lessonSession.updateMany({
    where: { id, organizationId: user.organizationId, status: "SCHEDULED" },
    data: { status: "CANCELLED" },
  });
  if (updated.count !== 1) return { ok: false, message: "这节课不存在，或已经不能取消。" };
  refresh();
  return { ok: true };
}
