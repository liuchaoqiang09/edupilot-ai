"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { classRoster } from "@/lib/class-roster";
import type { RosterStudent } from "@/lib/roster-student";
import { calendarDateKey, CourseHourError, periodValidity, releaseChargedHour } from "@/lib/course-hours";
import { requireRole } from "@/lib/auth";
import { formatClock, formatDateTime, formatMonthDay, parseShanghaiDateTime, shanghaiDateKey } from "@/lib/datetime";
import { findScheduleConflicts, recurringConflictMessage, roomCapacityWarning, singleConflictWarning, type ExistingLesson } from "@/lib/lesson-conflicts";
import { cancelPendingLessonRequests, reviewLessonRequest } from "@/lib/lesson-requests";
import { notifyLessonChange } from "@/lib/parent-notice";
import { prisma } from "@/lib/prisma";
import { recurringDates } from "@/lib/recurring-schedule";

export type FieldErrors = Partial<Record<"classGroupId" | "teacherId" | "startAt" | "endAt" | "classroomId" | "students", string>>;

export type ActionResult = {
  ok: boolean;
  message?: string;
  warning?: string;
  fieldErrors?: FieldErrors;
};

export type RecurringFieldErrors = Partial<Record<"classGroupId" | "startDate" | "endDate" | "weekdays" | "startTime" | "endTime" | "classroomId" | "students", string>>;

export type RecurringResult = {
  ok: boolean;
  message?: string;
  created: number;
  skipped: number;
  firstDate?: string;
  needsCapacityConfirm?: boolean;
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
  const keyword = query.trim();
  if (!keyword) return [];
  return listOtherStudents(classGroupId, keyword);
}

export async function loadOtherStudents(classGroupId: string): Promise<RosterStudent[]> {
  return listOtherStudents(classGroupId, null);
}

async function listOtherStudents(classGroupId: string, keyword: string | null): Promise<RosterStudent[]> {
  const user = await requireRole("OWNER", "owner");
  if (!classGroupId) return [];
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
      ...(keyword
        ? { OR: [{ name: { contains: keyword } }, { studentNo: { contains: keyword, mode: "insensitive" } }] }
        : {}),
      ...(exclude.length > 0 ? { id: { notIn: exclude } } : {}),
    },
    select: {
      id: true,
      name: true,
      studentNo: true,
      grade: true,
      age: true,
      courseHourBalances: { select: { courseId: true, remainingHours: true } },
      enrollments: {
        select: { courseId: true, status: true, startDate: true, endDate: true, course: { select: { billingType: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { name: "asc" },
    ...(keyword ? { take: 30 } : {}),
  });
  const today = shanghaiDateKey();
  return found.map((student) => ({
    id: student.id,
    name: student.name,
    studentNo: student.studentNo,
    grade: student.grade,
    age: student.age,
    enrollmentLabel: otherStudentLabel(student, classGroup.courseId, today),
  }));
}

function otherStudentLabel(
  student: {
    courseHourBalances: { courseId: string; remainingHours: number }[];
    enrollments: { courseId: string; status: "PAID" | "PARTIAL" | "UNPAID"; startDate: Date | null; endDate: Date | null; course: { billingType: "PER_LESSON" | "PER_PERIOD" } }[];
  },
  courseId: string,
  today: string,
) {
  const current = student.enrollments.find((enrollment) => enrollment.courseId === courseId);
  if (current) return "同课程不同班";
  if (student.enrollments.length === 0) return "未报名";

  const byCourse = new Map<string, { billingType: "PER_LESSON" | "PER_PERIOD"; windows: { start: string; end: string }[] }>();
  for (const enrollment of student.enrollments) {
    const course = byCourse.get(enrollment.courseId) ?? { billingType: enrollment.course.billingType, windows: [] };
    if (enrollment.startDate && enrollment.endDate) {
      course.windows.push({ start: calendarDateKey(enrollment.startDate), end: calendarDateKey(enrollment.endDate) });
    }
    byCourse.set(enrollment.courseId, course);
  }
  let expiredOn: string | null = null;
  let zeroHours = false;
  for (const [otherCourseId, course] of byCourse) {
    if (course.billingType === "PER_PERIOD") {
      const period = periodValidity(course.windows, today);
      if (period.status === "已过期" && period.end !== "—" && (expiredOn == null || period.end > expiredOn)) expiredOn = period.end;
    } else {
      const remaining = student.courseHourBalances.find((item) => item.courseId === otherCourseId)?.remainingHours ?? 0;
      if (remaining === 0) zeroHours = true;
    }
  }
  if (expiredOn) return `已过期 ${expiredOn}`;
  if (zeroHours) return "无课时";
  return "未报名此课程";
}

async function lessonsInWindow(organizationId: string, startAt: Date, endAt: Date, studentIds: string[], excludeLessonId?: string): Promise<ExistingLesson[]> {
  const rows = await prisma.lessonSession.findMany({
    where: {
      organizationId,
      status: { not: "CANCELLED" },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
      ...(excludeLessonId ? { id: { not: excludeLessonId } } : {}),
    },
    select: {
      id: true,
      title: true,
      startAt: true,
      endAt: true,
      teacherId: true,
      classGroupId: true,
      location: true,
      classroomId: true,
      students: {
        where: { studentId: { in: studentIds.length > 0 ? studentIds : ["__none__"] } },
        select: { studentId: true, student: { select: { name: true, studentNo: true } } },
      },
    },
  });
  return rows.map((lesson) => ({
    id: lesson.id,
    title: lesson.title,
    startAt: lesson.startAt,
    endAt: lesson.endAt,
    teacherId: lesson.teacherId,
    classGroupId: lesson.classGroupId,
    location: lesson.location,
    classroomId: lesson.classroomId,
    students: lesson.students.map((row) => ({ id: row.studentId, name: row.student.name, studentNo: row.student.studentNo })),
  }));
}

export async function createLesson(formData: FormData): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  const fieldErrors: FieldErrors = {};
  const classGroupId = clean(formData.get("classGroupId"));
  const teacherId = clean(formData.get("teacherId"));
  const startAt = parseShanghaiDateTime(clean(formData.get("startAt")));
  const endAt = parseShanghaiDateTime(clean(formData.get("endAt")));
  const classroomId = clean(formData.get("classroomId"));
  const studentIds = [...new Set(formData.getAll("studentIds").filter((value): value is string => typeof value === "string" && value.length > 0))];

  if (!classGroupId) fieldErrors.classGroupId = "请选择班级。";
  if (!teacherId) fieldErrors.teacherId = "请选择教师。";
  if (!startAt) fieldErrors.startAt = "请填写开始时间。";
  if (!endAt) fieldErrors.endAt = "请填写结束时间。";
  else if (startAt && endAt <= startAt) fieldErrors.endAt = "结束时间必须晚于开始时间。";
  if (!classroomId) fieldErrors.classroomId = "请选择教室。";
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
  const classroom = await prisma.classroom.findFirst({
    where: { id: classroomId, organizationId: user.organizationId, available: true },
    select: { id: true, name: true, capacity: true },
  });
  if (!classroom) return { ok: false, fieldErrors: { classroomId: "只能选择本机构可用的教室。" } };

  const conflicts = findScheduleConflicts(
    { teacherId: teacher.id, classGroupId: classGroup.id, location: classroom.name, classroomId: classroom.id, studentIds: students.map((student) => student.id), startAt: startAt!, endAt: endAt! },
    await lessonsInWindow(user.organizationId, startAt!, endAt!, students.map((student) => student.id)),
  );
  const seats = roomCapacityWarning(students.length, classroom.capacity, classroom.name);
  const confirm = "再次点击保存仍会继续，请确认是否冲突。";
  if ((conflicts.length > 0 || seats) && formData.get("acknowledgeConflict") !== "1") {
    const warning = [
      conflicts.length > 0 ? singleConflictWarning(conflicts, formatDateTime, "") : "",
      seats,
      confirm,
    ].filter(Boolean).join("\n");
    return { ok: false, warning };
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
      location: classroom.name,
      classroomId: classroom.id,
      createdById: user.id,
      students: {
        create: students.map((student) => {
          const requested = clean(formData.get(`seat:${student.id}`));
          const seat = requested === "TRIAL" || requested === "GUEST" ? requested : "ENROLLED";
          return {
            organizationId: user.organizationId,
            studentId: student.id,
            seat,
            lastAction: seat === "TRIAL" ? "加入试听" : seat === "GUEST" ? "临时加入" : "加入课次",
          };
        }),
      },
    },
  });

  refresh();
  return {
    ok: true,
    warning: conflicts.length > 0
      ? "课次已保存。这次安排与已有课次仍有重叠。"
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
  const classroomId = clean(formData.get("classroomId"));
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
  if (!classroomId) fieldErrors.classroomId = "请选择教室。";
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
  const classroom = await prisma.classroom.findFirst({
    where: { id: classroomId, organizationId: user.organizationId, available: true },
    select: { id: true, name: true, capacity: true },
  });
  if (!classroom) return { ok: false, created: 0, skipped: 0, fieldErrors: { classroomId: "只能选择本机构可用的教室。" } };
  const seats = roomCapacityWarning(students.length, classroom.capacity, classroom.name);
  if (seats && formData.get("acknowledgeCapacity") !== "1") {
    return { ok: false, created: 0, skipped: 0, needsCapacityConfirm: true, message: `${seats}确认后仍会生成这些课次。` };
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

  const rosterIds = students.map((student) => student.id);
  const existing = await lessonsInWindow(user.organizationId, slots[0].startAt, slots[slots.length - 1].endAt, rosterIds);
  const open: typeof slots = [];
  const skips: { date: string; conflicts: ReturnType<typeof findScheduleConflicts> }[] = [];
  for (const slot of slots) {
    const conflicts = findScheduleConflicts({
      teacherId: classGroup.teacherId,
      classGroupId: classGroup.id,
      location: classroom.name,
      classroomId: classroom.id,
      studentIds: rosterIds,
      startAt: slot.startAt,
      endAt: slot.endAt,
    }, existing);
    if (conflicts.length > 0) skips.push({ date: slot.date, conflicts });
    else open.push(slot);
  }
  const skipped = skips.length;
  if (open.length === 0) {
    return { ok: true, created: 0, skipped, message: recurringConflictMessage(0, skips, formatMonthDay) };
  }
  if (open.length > 200) {
    return {
      ok: false,
      created: 0,
      skipped: 0,
      message: `这次会生成 ${open.length} 节课，超过单次上限 200 节。请缩短日期范围或少选几个星期，再分批排课。`,
    };
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
        location: classroom.name,
        classroomId: classroom.id,
        createdById: user.id,
      })),
      select: { id: true },
    });
    if (students.length > 0) {
      await tx.lessonStudent.createMany({
        data: created.flatMap((lesson) => students.map((student) => {
          const requested = clean(formData.get(`seat:${student.id}`));
          const seat = requested === "TRIAL" || requested === "GUEST" ? requested : "ENROLLED";
          return {
            organizationId: user.organizationId,
            lessonSessionId: lesson.id,
            studentId: student.id,
            seat,
            lastAction: seat === "TRIAL" ? "加入试听" : seat === "GUEST" ? "临时加入" : "加入课次",
          };
        })),
      });
    }
  }, { timeout: 20000 });

  refresh();
  const teacherNote = classGroup.teacher.user?.roles.includes("TEACHER") ? "" : "这位教师还没有关联可登录的教师账号，教师端暂时看不到这些课。";
  const conflictNote = skips.length > 0 ? recurringConflictMessage(open.length, skips, formatMonthDay) : `已生成 ${open.length} 节课。`;
  return {
    ok: true,
    created: open.length,
    skipped,
    firstDate: open[0].date,
    message: [conflictNote, teacherNote].filter(Boolean).join("\n"),
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

  const conflicts = findScheduleConflicts(
    { teacherId: teacher.id, classGroupId: "", location: "", studentIds: [], startAt: lesson.startAt, endAt: lesson.endAt },
    await lessonsInWindow(user.organizationId, lesson.startAt, lesson.endAt, [], lesson.id),
    ["teacher"],
  );
  if (conflicts.length > 0 && formData.get("acknowledgeConflict") !== "1") {
    return { ok: false, warning: singleConflictWarning(conflicts, formatDateTime, "再次点击更换仍会继续，请确认是否冲突。") };
  }

  const updated = await prisma.lessonSession.updateMany({
    where: { id: lesson.id, organizationId: user.organizationId, status: { not: "CANCELLED" } },
    data: { teacherId: teacher.id },
  });
  if (updated.count !== 1) return { ok: false, message: "教师没有更换，请刷新后再试。" };
  await cancelPendingLessonRequests(user.organizationId, lesson.id, "负责人已直接更换教师");
  const changed = await prisma.lessonSession.findFirst({
    where: { id: lesson.id, organizationId: user.organizationId },
    select: { title: true, startAt: true, teacher: { select: { name: true } }, students: { select: { studentId: true } } },
  });
  if (changed) {
    await notifyLessonChange({
      organizationId: user.organizationId,
      studentIds: changed.students.map((row) => row.studentId),
      title: changed.title,
      when: changed.startAt,
      change: `改由${changed.teacher.name}上课`,
      dedupeKey: `lesson:${lesson.id}:teacher:${teacher.id}`,
    });
  }

  refresh();
  return {
    ok: true,
    warning: conflicts.length > 0
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
        select: { id: true, courseId: true, students: { select: { id: true, studentId: true, hoursCharged: true } } },
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
        detail: returned > 0
          ? `取消课次，并退回 ${returned} 次已扣课时。取消后不能恢复，避免重复扣课时。`
          : "取消课次。取消后不能恢复。",
      });
      return returned;
    });
  } catch (error) {
    if (error instanceof CourseHourError) return { ok: false, message: error.message };
    throw error;
  }
  const cancelled = await prisma.lessonSession.findFirst({
    where: { id, organizationId: user.organizationId, status: "CANCELLED" },
    select: { title: true, startAt: true, students: { select: { studentId: true } } },
  });
  if (cancelled) {
    await notifyLessonChange({
      organizationId: user.organizationId,
      studentIds: cancelled.students.map((row) => row.studentId),
      title: cancelled.title,
      when: cancelled.startAt,
      change: "已取消",
      dedupeKey: `lesson:${id}:cancelled`,
    });
  }
  refresh();
  return {
    ok: true,
    message: refunded > 0
      ? `课次已取消，并退回 ${refunded} 次已扣课时。取消后不能恢复，以免再次扣费。`
      : "课次已取消。取消后不能恢复。",
  };
}

export async function rescheduleLesson(lessonId: string, formData: FormData): Promise<ActionResult & { needsChargeConfirm?: boolean }> {
  const user = await requireRole("OWNER", "owner");
  const lesson = await prisma.lessonSession.findFirst({
    where: { id: lessonId, organizationId: user.organizationId, status: { not: "CANCELLED" } },
    select: {
      id: true,
      title: true,
      startAt: true,
      endAt: true,
      location: true,
      classroomId: true,
      classGroupId: true,
      teacherId: true,
      students: { select: { studentId: true, hoursCharged: true } },
    },
  });
  if (!lesson) return { ok: false, message: "这节课不存在，或已经取消。" };
  const startAt = parseShanghaiDateTime(clean(formData.get("startAt")));
  const endAt = parseShanghaiDateTime(clean(formData.get("endAt")));
  if (!startAt || !endAt || endAt <= startAt) return { ok: false, fieldErrors: { startAt: "请填写有效的开始和结束时间。" }, message: "请填写有效的开始和结束时间。" };
  const charged = lesson.students.some((row) => row.hoursCharged);
  if (charged && formData.get("confirmCharged") !== "1") {
    return { ok: false, needsChargeConfirm: true, message: "这节课已有学生扣过课时。改时间不会退回已扣课时。确认后才会保存。" };
  }
  const existing = await lessonsInWindow(user.organizationId, startAt, endAt, lesson.students.map((row) => row.studentId), lesson.id);
  const conflicts = findScheduleConflicts({
    teacherId: lesson.teacherId,
    classGroupId: lesson.classGroupId,
    location: lesson.location,
    classroomId: lesson.classroomId,
    studentIds: lesson.students.map((row) => row.studentId),
    startAt,
    endAt,
  }, existing);
  if (conflicts.length > 0 && formData.get("acknowledgeConflict") !== "1") {
    return { ok: false, warning: singleConflictWarning(conflicts, formatDateTime, "再次点击确认修改仍会继续，请确认是否冲突。"), message: "改时间前发现冲突。确认后才会保存。" };
  }
  const from = formatDateTime(lesson.startAt);
  const to = formatDateTime(startAt);
  await prisma.$transaction(async (tx) => {
    await tx.lessonSession.update({ where: { id: lesson.id }, data: { startAt, endAt } });
    await writeAudit(tx, {
      organizationId: user.organizationId,
      actorId: user.id,
      action: "LESSON_RESCHEDULED",
      targetType: "LessonSession",
      targetId: lesson.id,
      detail: `把「${lesson.title ?? "课次"}」从 ${from} 改到 ${to}${charged ? "，当时已有学生扣过课时" : ""}`,
    });
  });
  await cancelPendingLessonRequests(user.organizationId, lesson.id, "负责人已直接修改时间");
  if (lesson.startAt.getTime() !== startAt.getTime() || lesson.endAt.getTime() !== endAt.getTime()) {
    await notifyLessonChange({
      organizationId: user.organizationId,
      studentIds: lesson.students.map((row) => row.studentId),
      title: lesson.title,
      when: startAt,
      change: `上课时间改为 ${formatDateTime(startAt)}–${formatClock(endAt)}`,
      dedupeKey: `lesson:${lesson.id}:time:${startAt.toISOString()}:${endAt.toISOString()}`,
    });
  }
  refresh();
  revalidatePath("/owner/audit");
  return { ok: true, message: "上课时间已修改。" };
}

export async function decideLessonRequest(requestId: string, decision: "APPROVED" | "REJECTED"): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  const result = await reviewLessonRequest({ organizationId: user.organizationId, userId: user.id, requestId, decision });
  refresh();
  revalidatePath("/teacher/schedule");
  revalidatePath("/owner/todos");
  return result;
}

export async function changeLessonClassroom(lessonId: string, formData: FormData): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  const classroomId = clean(formData.get("classroomId"));
  if (!classroomId) return { ok: false, fieldErrors: { classroomId: "请选择教室。" } };
  const lesson = await prisma.lessonSession.findFirst({
    where: { id: lessonId, organizationId: user.organizationId, status: { not: "CANCELLED" } },
    select: {
      id: true,
      title: true,
      startAt: true,
      endAt: true,
      location: true,
      classroomId: true,
      classGroupId: true,
      teacherId: true,
      students: { select: { studentId: true } },
    },
  });
  if (!lesson) return { ok: false, message: "这节课不存在，或已经取消。" };
  if (lesson.classroomId === classroomId) return { ok: true, message: "教室没有变化。" };
  const classroom = await prisma.classroom.findFirst({
    where: { id: classroomId, organizationId: user.organizationId, available: true },
    select: { id: true, name: true, capacity: true },
  });
  if (!classroom) return { ok: false, fieldErrors: { classroomId: "只能改到本机构可用的教室。" } };
  const existing = await lessonsInWindow(user.organizationId, lesson.startAt, lesson.endAt, [], lesson.id);
  const conflicts = findScheduleConflicts({
    teacherId: lesson.teacherId,
    classGroupId: lesson.classGroupId,
    location: classroom.name,
    classroomId: classroom.id,
    studentIds: [],
    startAt: lesson.startAt,
    endAt: lesson.endAt,
  }, existing, ["room"]);
  const seats = roomCapacityWarning(lesson.students.length, classroom.capacity, classroom.name);
  if ((conflicts.length > 0 || seats) && formData.get("acknowledgeConflict") !== "1") {
    return {
      ok: false,
      warning: [conflicts.length > 0 ? singleConflictWarning(conflicts, formatDateTime, "") : "", seats, "再次点击保存仍会继续。"].filter(Boolean).join("\n"),
      message: "更换教室前需要确认。",
    };
  }
  const from = lesson.location?.trim() || "未填地点";
  await prisma.$transaction(async (tx) => {
    await tx.lessonSession.update({
      where: { id: lesson.id },
      data: { classroomId: classroom.id, location: classroom.name },
    });
    await writeAudit(tx, {
      organizationId: user.organizationId,
      actorId: user.id,
      action: "LESSON_ROOM_CHANGED",
      targetType: "LessonSession",
      targetId: lesson.id,
      detail: `把「${lesson.title ?? "课次"}」的教室从 ${from} 改到 ${classroom.name}`,
    });
  });
  await notifyLessonChange({
    organizationId: user.organizationId,
    studentIds: lesson.students.map((row) => row.studentId),
    title: lesson.title,
    when: lesson.startAt,
    change: `上课地点改为 ${classroom.name}`,
    dedupeKey: `lesson:${lesson.id}:room:${classroom.id}`,
  });
  refresh();
  revalidatePath("/owner/audit");
  revalidatePath("/owner/rooms");
  return { ok: true, message: `教室已改为 ${classroom.name}。` };
}
