"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { classRoster, enrollmentLabel } from "@/lib/class-roster";
import type { RosterStudent } from "@/lib/roster-student";
import { CourseHourError, releaseChargedHour } from "@/lib/course-hours";
import { requireRole } from "@/lib/auth";
import { formatDateTime, parseShanghaiDateTime } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { recurringDates } from "@/lib/recurring-schedule";

export type FieldErrors = Partial<Record<"classGroupId" | "teacherId" | "startAt" | "endAt" | "location" | "students", string>>;

export type ActionResult = {
  ok: boolean;
  message?: string;
  warning?: string;
  fieldErrors?: FieldErrors;
};

export type RecurringFieldErrors = Partial<Record<"classGroupId" | "startDate" | "endDate" | "weekdays" | "startTime" | "endTime" | "location" | "students", string>>;

export type RecurringResult = {
  ok: boolean;
  message?: string;
  created: number;
  skipped: number;
  firstDate?: string;
  fieldErrors?: RecurringFieldErrors;
};

function clean(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function refresh() {
  revalidatePath("/owner/schedule");
  revalidatePath("/teacher");
  revalidatePath("/teacher/schedule");
  revalidatePath("/parent/schedule");
  revalidatePath("/parent/attendance");
  revalidatePath("/owner/billing");
  revalidatePath("/owner");
  revalidatePath("/owner/stats");
  revalidatePath("/owner/attendance");
}

export async function loadClassRoster(classGroupId: string): Promise<RosterStudent[]> {
  const user = await requireRole("OWNER", "owner");
  if (!classGroupId) return [];
  const classGroup = await prisma.classGroup.findFirst({
    where: { id: classGroupId, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!classGroup) return [];
  return classRoster(user.organizationId, classGroup.id);
}

export async function searchOtherStudents(classGroupId: string, query: string): Promise<RosterStudent[]> {
  const user = await requireRole("OWNER", "owner");
  const keyword = query.trim();
  if (!classGroupId || keyword.length === 0) return [];
  const classGroup = await prisma.classGroup.findFirst({
    where: { id: classGroupId, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true, courseId: true },
  });
  if (!classGroup) return [];
  const enrolled = await prisma.enrollment.findMany({
    where: { organizationId: user.organizationId, classGroupId: classGroup.id, student: { status: "ACTIVE" } },
    select: { studentId: true },
    distinct: ["studentId"],
  });
  const exclude = enrolled.map((row) => row.studentId);
  const found = await prisma.student.findMany({
    where: {
      organizationId: user.organizationId,
      status: "ACTIVE",
      name: { contains: keyword },
      ...(exclude.length > 0 ? { id: { notIn: exclude } } : {}),
    },
    select: {
      id: true,
      name: true,
      grade: true,
      age: true,
      enrollments: {
        where: { courseId: classGroup.courseId },
        select: { status: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { name: "asc" },
    take: 30,
  });
  return found.map((student) => ({
    id: student.id,
    name: student.name,
    grade: student.grade,
    age: student.age,
    enrollmentLabel: enrollmentLabel(student.enrollments[0]?.status),
  }));
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
    select: { id: true, user: { select: { roles: true } } },
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
      : teacher.user?.roles.includes("TEACHER")
        ? undefined
        : "课次已保存。这位教师还没有关联可登录的教师账号，教师端暂时看不到这节课。",
  };
}

function daySpan(start: string, end: string) {
  const from = new Date(`${start}T12:00:00+08:00`).getTime();
  const to = new Date(`${end}T12:00:00+08:00`).getTime();
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

export async function createRecurringLessons(formData: FormData): Promise<RecurringResult> {
  const user = await requireRole("OWNER", "owner");
  const fieldErrors: RecurringFieldErrors = {};
  const classGroupId = clean(formData.get("classGroupId"));
  const startDate = clean(formData.get("startDate"));
  const endDate = clean(formData.get("endDate"));
  const startTime = clean(formData.get("startTime"));
  const endTime = clean(formData.get("endTime"));
  const location = clean(formData.get("location"));
  const skipWeekends = formData.get("skipWeekends") === "1";
  const weekdays = [...new Set(
    formData.getAll("weekdays").flatMap((value) => {
      if (typeof value !== "string" || !/^[0-6]$/.test(value)) return [];
      return [Number(value)];
    }),
  )];
  const studentIds = [...new Set(formData.getAll("studentIds").filter((value): value is string => typeof value === "string" && value.length > 0))];

  if (!classGroupId) fieldErrors.classGroupId = "请选择班级。";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) fieldErrors.startDate = "请选择开始日期。";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) fieldErrors.endDate = "请选择结束日期。";
  else if (/^\d{4}-\d{2}-\d{2}$/.test(startDate) && endDate < startDate) fieldErrors.endDate = "结束日期不能早于开始日期。";
  else if (/^\d{4}-\d{2}-\d{2}$/.test(startDate) && daySpan(startDate, endDate) > 370) fieldErrors.endDate = "一次最多排 370 天。学期更长时请分成两次。";
  if (weekdays.length === 0) fieldErrors.weekdays = "请至少选择一个星期。";
  if (!/^\d{2}:\d{2}$/.test(startTime)) fieldErrors.startTime = "请填写开始时间。";
  if (!/^\d{2}:\d{2}$/.test(endTime)) fieldErrors.endTime = "请填写结束时间。";
  else if (startTime && endTime <= startTime) fieldErrors.endTime = "结束时间必须晚于开始时间。跨天的课请用单次排课。";
  if (location.length > 40) fieldErrors.location = "地点不能超过 40 个字。";
  if (Object.keys(fieldErrors).length > 0) return { ok: false, created: 0, skipped: 0, fieldErrors };

  const classGroup = await prisma.classGroup.findFirst({
    where: { id: classGroupId, organizationId: user.organizationId, status: "ACTIVE" },
    select: {
      id: true,
      courseId: true,
      name: true,
      teacherId: true,
      course: { select: { name: true } },
      teacher: { select: { id: true, status: true, user: { select: { roles: true } } } },
    },
  });
  if (!classGroup || classGroup.teacher.status !== "ACTIVE") {
    return { ok: false, created: 0, skipped: 0, fieldErrors: { classGroupId: "只能选择本机构启用中的班级，且班级教师仍在职。" } };
  }

  const students = studentIds.length
    ? await prisma.student.findMany({
        where: { id: { in: studentIds }, organizationId: user.organizationId, status: "ACTIVE" },
        select: { id: true },
      })
    : [];
  if (students.length !== studentIds.length) {
    return { ok: false, created: 0, skipped: 0, fieldErrors: { students: "名单里有不属于本机构或已停用的学生。" } };
  }

  const { dates, truncated } = recurringDates(startDate, endDate, weekdays, skipWeekends);
  if (truncated) return { ok: false, created: 0, skipped: 0, message: "日期范围太长，请缩短后再排。" };
  if (dates.length === 0) {
    return { ok: false, created: 0, skipped: 0, message: skipWeekends ? "勾选跳过周末后，这个范围内没有可排的日期。" : "这个日期范围内没有符合所选星期的日期。" };
  }

  const slots = dates.flatMap((date) => {
    const startAt = parseShanghaiDateTime(`${date}T${startTime}`);
    const endAt = parseShanghaiDateTime(`${date}T${endTime}`);
    return startAt && endAt ? [{ date, startAt, endAt }] : [];
  });
  if (slots.length !== dates.length) return { ok: false, created: 0, skipped: 0, message: "上课时间无法识别。" };

  const existing = await prisma.lessonSession.findMany({
    where: {
      organizationId: user.organizationId,
      status: { not: "CANCELLED" },
      startAt: { lt: slots[slots.length - 1].endAt },
      endAt: { gt: slots[0].startAt },
      OR: [{ teacherId: classGroup.teacherId }, { classGroupId: classGroup.id }],
    },
    select: { classGroupId: true, teacherId: true, startAt: true, endAt: true },
  });

  const open = slots.filter((slot) => !existing.some((lesson) =>
    (lesson.classGroupId === classGroup.id || lesson.teacherId === classGroup.teacherId)
    && lesson.startAt < slot.endAt
    && lesson.endAt > slot.startAt,
  ));
  const skipped = slots.length - open.length;
  if (open.length === 0) {
    return { ok: true, created: 0, skipped, message: `没有生成课次。有 ${skipped} 节课因时间冲突被跳过。` };
  }

  const title = `${classGroup.course.name} · ${classGroup.name}`;
  await prisma.$transaction(async (tx) => {
    const created = await tx.lessonSession.createManyAndReturn({
      data: open.map((slot) => ({
        organizationId: user.organizationId,
        classGroupId: classGroup.id,
        courseId: classGroup.courseId,
        teacherId: classGroup.teacherId,
        title,
        startAt: slot.startAt,
        endAt: slot.endAt,
        location: location || null,
        createdById: user.id,
      })),
      select: { id: true },
    });
    if (students.length > 0) {
      await tx.lessonStudent.createMany({
        data: created.flatMap((lesson) => students.map((student) => ({
          organizationId: user.organizationId,
          lessonSessionId: lesson.id,
          studentId: student.id,
          lastAction: "加入课次",
        }))),
      });
    }
  }, { timeout: 20000 });

  refresh();
  const teacherNote = classGroup.teacher.user?.roles.includes("TEACHER") ? "" : "这位教师还没有关联可登录的教师账号，教师端暂时看不到这些课。";
  const conflictNote = skipped > 0 ? `有 ${skipped} 节课因时间冲突被跳过。` : "";
  return {
    ok: true,
    created: open.length,
    skipped,
    firstDate: open[0].date,
    message: [`已生成 ${open.length} 节课。`, conflictNote, teacherNote].filter(Boolean).join(""),
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
    select: { id: true, user: { select: { roles: true } } },
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
      : teacher.user?.roles.includes("TEACHER")
        ? undefined
        : "教师已更换。这位教师还没有关联可登录的教师账号，教师端暂时看不到这节课。",
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
  let refunded = 0;
  try {
    refunded = await prisma.$transaction(async (tx) => {
      const lesson = await tx.lessonSession.findFirst({
        where: { id, organizationId: user.organizationId, status: "SCHEDULED" },
        select: { id: true, courseId: true, students: { select: { id: true, studentId: true } } },
      });
      if (!lesson) throw new CourseHourError("这节课不存在，或已经不能取消。");
      let returned = 0;
      for (const row of lesson.students) {
        const released = await releaseChargedHour(tx, {
          organizationId: user.organizationId,
          lessonStudentId: row.id,
          studentId: row.studentId,
          courseId: lesson.courseId,
        });
        if (released) returned += 1;
      }
      const updated = await tx.lessonSession.updateMany({
        where: { id: lesson.id, organizationId: user.organizationId, status: "SCHEDULED" },
        data: { status: "CANCELLED" },
      });
      if (updated.count !== 1) throw new CourseHourError("这节课不存在，或已经不能取消。");
      await writeAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "LESSON_CANCELLED",
        targetType: "LessonSession",
        targetId: lesson.id,
        detail: returned > 0 ? `取消课次，并退回 ${returned} 次已扣课时` : "取消课次",
      });
      return returned;
    });
  } catch (error) {
    if (error instanceof CourseHourError) return { ok: false, message: error.message };
    throw error;
  }
  refresh();
  return { ok: true, message: refunded > 0 ? `课次已取消，并退回 ${refunded} 次已扣课时。` : "课次已取消。" };
}
