"use server";

import { revalidatePath } from "next/cache";
import { AttendanceStatus, LeaveKind, Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth";
import { recordPayment } from "@/lib/billing-ledger";
import { creditCourseHours, CourseHourError, releaseChargedHour, syncAttendanceCharge } from "@/lib/course-hours";
import { enrollmentStanding, isPaymentMethod } from "@/lib/enrollment-money";
import { parseShanghaiDateTime } from "@/lib/datetime";
import { convertAbsentToLeaveInTx, leaveKindLabel, toAttendanceFields } from "@/lib/leave-kind";
import { cancelLessonRequest, submitLessonRequest } from "@/lib/lesson-requests";
import { makeupLabel } from "@/lib/lesson-seat";
import { resolveTeacherAddSeat } from "@/lib/lesson-seat-rules";
import { createMakeupRow } from "@/lib/makeup";
import { notifyMakeupArranged } from "@/lib/parent-notice";
import { prisma } from "@/lib/prisma";
import { parseMainlandPhone } from "@/lib/student-profile";

export type ActionResult = { ok: boolean; message?: string; sourceId?: string };

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
      teacherId: true,
      courseId: true,
      course: { select: { name: true, billingType: true } },
      students: { select: { id: true, studentId: true, seat: true, student: { select: { name: true, status: true } } } },
    },
  });
  if (!lesson) return { ok: false, message: "这节课不存在，或你不是授课教师，不能修改考勤。" };

  const inactiveSkipped: string[] = [];
  type AttendanceUpdate = {
    id: string;
    studentId: string;
    seat: (typeof lesson.students)[number]["seat"];
    student: (typeof lesson.students)[number]["student"];
    note: string;
  } & (
    | { invalid: true; status: string; leaveKind: null }
    | { invalid: false; status: AttendanceStatus; leaveKind: LeaveKind | null }
  );
  const updates: AttendanceUpdate[] = [];
  for (const row of lesson.students) {
    const raw = String(formData.get(`status:${row.studentId}`) ?? "");
    const note = String(formData.get(`note:${row.studentId}`) ?? "").trim();
    if (!raw) continue;
    const fields = toAttendanceFields(raw);
    if (!fields) {
      updates.push({ ...row, invalid: true, note, status: raw, leaveKind: null });
      continue;
    }
    if (row.student.status !== "ACTIVE") {
      inactiveSkipped.push(row.student.name);
      continue;
    }
    updates.push({ ...row, invalid: false, note, status: fields.status, leaveKind: fields.leaveKind });
  }
  if (updates.length === 0 && inactiveSkipped.length === 0 && lesson.students.length === 0) {
    return { ok: true, message: "这节课没有学生，无需保存考勤。" };
  }
  if (updates.some((row) => row.invalid)) return { ok: false, message: "考勤状态无效。" };
  if (updates.some((row) => row.note.length > 80)) return { ok: false, message: "备注不能超过 80 个字。" };

  const charged = new Set(["PRESENT", "LATE", "ABSENT"]);
  const balances = await prisma.courseHourBalance.findMany({
    where: {
      organizationId: user.organizationId,
      courseId: lesson.courseId,
      studentId: { in: updates.map((row) => row.studentId) },
    },
    select: { studentId: true, remainingHours: true },
  });
  const remainingByStudent = new Map(balances.map((row) => [row.studentId, row.remainingHours]));
  const skipped: string[] = [];

  try {
    await prisma.$transaction(async (tx) => {
      // 课中若负责人已换教师，整笔回滚，避免半截考勤挂在已无权教师名下。
      const owned = await tx.$queryRaw<Array<{ id: string; teacherId: string }>>`
        SELECT id, "teacherId" FROM "edupilot"."LessonSession"
        WHERE id = ${lesson.id} AND "organizationId" = ${user.organizationId} AND status <> 'CANCELLED'
        FOR UPDATE
      `;
      if (owned.length !== 1 || owned[0].teacherId !== teacher.id) {
        throw new CourseHourError("负责人已更换授课教师或取消了这节课。请刷新课表；刚才的考勤没有写入。");
      }
      for (const row of updates) {
        if (row.invalid) continue;
        await tx.$queryRaw`
          SELECT id FROM "edupilot"."LessonStudent"
          WHERE id = ${row.id} AND "organizationId" = ${user.organizationId}
          FOR UPDATE
        `;
        const live = await tx.lessonStudent.findFirst({
          where: { id: row.id, organizationId: user.organizationId },
          select: {
            id: true,
            seat: true,
            hoursCharged: true,
            attendanceStatus: true,
            parentLeaveAt: true,
            student: { select: { name: true, status: true } },
          },
        });
        if (!live || live.student.status !== "ACTIVE") {
          inactiveSkipped.push(row.student.name);
          continue;
        }
        const seat = live.seat;
        const needsHour = charged.has(row.status) && lesson.course.billingType === "PER_LESSON" && seat !== "TRIAL" && seat !== "CONVERTED";
        if (needsHour && !live.hoursCharged && (remainingByStudent.get(row.studentId) ?? 0) < 1) {
          skipped.push(live.student.name);
          continue;
        }
        const outcome = await syncAttendanceCharge(tx, {
          organizationId: user.organizationId,
          lessonStudentId: row.id,
          studentId: row.studentId,
          studentName: live.student.name,
          courseId: lesson.courseId,
          courseName: lesson.course.name,
          billingType: lesson.course.billingType,
          seat,
          shouldCharge: charged.has(row.status),
          attendanceStatus: row.status as AttendanceStatus,
          attendanceNote: row.note || null,
          leaveKind: row.leaveKind,
        });
        if (live.attendanceStatus === "ABSENT" && row.status === "LEAVE") {
          const kind = row.leaveKind === "SICK" ? leaveKindLabel.SICK : leaveKindLabel.PERSONAL;
          await writeAudit(tx, {
            organizationId: user.organizationId,
            actorId: user.id,
            action: "ABSENT_TO_LEAVE",
            targetType: "LessonStudent",
            targetId: row.id,
            detail: `教师将${live.student.name}从缺勤改为${kind}，${outcome === "refunded" ? "退回1课时" : "仅改状态，未扣课时无需退回"}`,
          });
        }
        if (live.parentLeaveAt && charged.has(row.status)) {
          await writeAudit(tx, {
            organizationId: user.organizationId,
            actorId: user.id,
            action: "ATTENDANCE_OVERRIDE_LEAVE",
            targetType: "LessonStudent",
            targetId: row.id,
            detail: `教师覆盖家长请假为${row.status === "PRESENT" ? "出勤" : row.status === "LATE" ? "迟到" : "缺勤"}：${live.student.name}`,
          });
        }
        if (outcome === "charged") {
          remainingByStudent.set(row.studentId, Math.max((remainingByStudent.get(row.studentId) ?? 1) - 1, 0));
        } else if (outcome === "refunded") {
          remainingByStudent.set(row.studentId, (remainingByStudent.get(row.studentId) ?? 0) + 1);
        }
      }
      const stillOwned = await tx.lessonSession.findFirst({
        where: { id: lesson.id, organizationId: user.organizationId, teacherId: teacher.id, status: { not: "CANCELLED" } },
        select: { id: true },
      });
      if (!stillOwned) {
        throw new CourseHourError("负责人刚更换了授课教师。请刷新课表；刚才的考勤没有写入。");
      }
    });
  } catch (error) {
    if (error instanceof CourseHourError) return { ok: false, message: error.message };
    throw error;
  }

  revalidatePath("/teacher");
  revalidatePath("/teacher/schedule");
  revalidatePath("/teacher/attendance");
  revalidatePath("/owner/schedule");
  revalidatePath("/owner/billing");
  revalidatePath("/parent/schedule");
  revalidatePath("/parent/attendance");
  const notes: string[] = [];
  if (inactiveSkipped.length > 0) {
    notes.push(`${[...new Set(inactiveSkipped)].join("、")}已停用，已跳过，没有改考勤也没有扣课时`);
  }
  if (skipped.length > 0) {
    notes.push(`${skipped.join("、")}课时不足，没有扣课时也没有写入出勤，请先加课时或改成请假`);
  }
  if (notes.length > 0) {
    return { ok: true, message: `其余考勤已保存。${notes.join("；")}。` };
  }
  return { ok: true };
}

function refreshRoster() {
  revalidatePath("/teacher");
  revalidatePath("/teacher/schedule");
  revalidatePath("/teacher/attendance");
  revalidatePath("/teacher/students");
  revalidatePath("/owner/schedule");
  revalidatePath("/owner/billing");
  revalidatePath("/owner/attendance");
  revalidatePath("/owner/audit");
}

async function ownUpcomingLesson(lessonId: string) {
  const user = await requireRole("TEACHER", "teacher");
  const teacher = await prisma.teacher.findFirst({
    where: { userId: user.id, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!teacher) return { user, teacher: null, lesson: null, message: "当前账号还没有关联在职教师档案。" };
  const lesson = await prisma.lessonSession.findFirst({
    where: { id: lessonId, organizationId: user.organizationId, teacherId: teacher.id, status: { not: "CANCELLED" } },
    select: {
      id: true,
      title: true,
      startAt: true,
      endAt: true,
      courseId: true,
      classGroupId: true,
      classroom: { select: { capacity: true, name: true } },
      students: { select: { studentId: true } },
    },
  });
  if (!lesson) return { user, teacher, lesson: null, message: "这节课不存在，或你不是授课教师。" };
  if (lesson.startAt.getTime() <= Date.now()) return { user, teacher, lesson: null, message: "课次已经开始，不能再改名单。" };
  return { user, teacher, lesson, message: "" };
}

export async function loadTeacherAddChoices(lessonId: string) {
  const { lesson } = await ownUpcomingLesson(lessonId);
  if (!lesson) return [];
  const rows = await prisma.enrollment.findMany({
    where: { organizationId: (await requireRole("TEACHER", "teacher")).organizationId, classGroupId: lesson.classGroupId, student: { status: "ACTIVE" } },
    select: { studentId: true, student: { select: { name: true } } },
    orderBy: { student: { name: "asc" } },
  });
  const onLesson = new Set(lesson.students.map((row) => row.studentId));
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    if (onLesson.has(row.studentId) || seen.has(row.studentId)) return [];
    seen.add(row.studentId);
    return [{ id: row.studentId, name: row.student.name }];
  });
}

export async function searchTeacherStudents(lessonId: string, query: string) {
  const keyword = query.trim();
  if (!keyword) return [];
  const { user, lesson } = await ownUpcomingLesson(lessonId);
  if (!lesson) return [];
  const onLesson = new Set(lesson.students.map((row) => row.studentId));
  const rows = await prisma.student.findMany({
    where: {
      organizationId: user.organizationId,
      status: "ACTIVE",
      OR: [
        { name: { contains: keyword, mode: "insensitive" } },
        { studentNo: { contains: keyword, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, studentNo: true },
    orderBy: { name: "asc" },
    take: 8,
  });
  return rows.filter((row) => !onLesson.has(row.id));
}

export async function addTeacherLessonStudent(lessonId: string, formData: FormData): Promise<ActionResult & { warning?: string }> {
  const owned = await ownUpcomingLesson(lessonId);
  const { user, lesson } = owned;
  if (!lesson) return { ok: false, message: owned.message };
  const studentId = String(formData.get("studentId") ?? "").trim();
  const requested = String(formData.get("seat") ?? "");
  if (!studentId) return { ok: false, message: "请选择学生。" };
  const student = await prisma.student.findFirst({
    where: { id: studentId, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true, name: true },
  });
  if (!student) return { ok: false, message: "只能加入本机构在读的学生。" };
  if (lesson.students.some((row) => row.studentId === student.id)) return { ok: false, message: "这名学生已经在这节课的名单里。" };
  let seat: "ENROLLED" | "GUEST" | "TRIAL";
  let lastAction: string;
  let forcedClass = false;
  try {
    const resolved = await resolveTeacherAddSeat(prisma, {
      organizationId: user.organizationId,
      studentId: student.id,
      studentName: student.name,
      courseId: lesson.courseId,
      classGroupId: lesson.classGroupId,
      requested,
    });
    seat = resolved.seat;
    lastAction = resolved.lastAction;
    forcedClass = resolved.forcedClass;
  } catch (error) {
    if (error instanceof CourseHourError) return { ok: false, message: error.message };
    throw error;
  }
  const overlap = await prisma.lessonSession.findFirst({
    where: {
      organizationId: user.organizationId,
      id: { not: lesson.id },
      status: { not: "CANCELLED" },
      startAt: { lt: lesson.endAt },
      endAt: { gt: lesson.startAt },
      students: { some: { studentId: student.id } },
    },
    select: { title: true },
  });
  const capacity = lesson.classroom?.capacity ?? null;
  const tooMany = capacity != null && lesson.students.length + 1 > capacity;
  if ((overlap || tooMany) && formData.get("acknowledgeConflict") !== "1") {
    const lines = [
      overlap ? `${student.name}在同一时间已有课次「${overlap.title ?? "课次"}」。` : "",
      tooMany ? `加入后有 ${lesson.students.length + 1} 人，教室「${lesson.classroom?.name ?? "教室"}」可坐 ${capacity} 人。` : "",
      "再次确认仍会加入。",
    ].filter(Boolean);
    return { ok: false, warning: lines.join("\n") };
  }
  try {
  await prisma.$transaction(async (tx) => {
    const created = await tx.lessonStudent.create({
      data: {
        organizationId: user.organizationId,
        lessonSessionId: lesson.id,
        studentId: student.id,
        seat,
        lastAction,
      },
      select: { id: true },
    });
    await writeAudit(tx, {
      organizationId: user.organizationId,
      actorId: user.id,
      action: "ROSTER_ADDED",
      targetType: "LessonStudent",
      targetId: created.id,
      detail: `教师在开课前把${student.name}加入「${lesson.title ?? "课次"}」，身份${seat === "TRIAL" ? "试听" : seat === "GUEST" ? "临时" : "本班"}`,
    });
  });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, message: "这名学生已经在这节课的名单里。" };
    }
    throw error;
  }
  refreshRoster();
  return { ok: true, message: forcedClass && requested !== "ENROLLED" ? "这名学生属于本班，已按本班加入。" : "已加入这节课。" };
}

export async function removeTeacherLessonStudent(lessonId: string, studentId: string): Promise<ActionResult> {
  const owned = await ownUpcomingLesson(lessonId);
  const { user, lesson } = owned;
  if (!lesson) return { ok: false, message: owned.message };
  const row = await prisma.lessonStudent.findFirst({
    where: { lessonSessionId: lesson.id, studentId, organizationId: user.organizationId },
    select: { id: true, student: { select: { name: true } }, makeups: { select: { id: true }, take: 1 } },
  });
  if (!row) return { ok: false, message: "名单里没有这名学生。" };
  if (row.makeups.length > 0) return { ok: false, message: "这次请假已经安排了补课。先处理补课名单，再移出这次请假。" };
  try {
    await prisma.$transaction(async (tx) => {
      const refunded = await releaseChargedHour(tx, {
        organizationId: user.organizationId,
        lessonStudentId: row.id,
        studentId,
        courseId: lesson.courseId,
      });
      const deleted = await tx.lessonStudent.deleteMany({
        where: { id: row.id, organizationId: user.organizationId, lessonSessionId: lesson.id },
      });
      if (deleted.count !== 1) throw new CourseHourError("名单里没有这名学生。");
      await writeAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "ROSTER_REMOVED",
        targetType: "LessonStudent",
        targetId: row.id,
        detail: refunded ? `教师移出${row.student.name}，并退回 1 课时` : `教师在开课前移出${row.student.name}`,
      });
    });
  } catch (error) {
    if (error instanceof CourseHourError) return { ok: false, message: error.message };
    throw error;
  }
  refreshRoster();
  return { ok: true, message: "已移出这节课。" };
}

export async function convertAbsentToLeaveForMakeup(
  lessonStudentId: string,
  formData: FormData,
): Promise<ActionResult & { sourceId?: string }> {
  const user = await requireRole("TEACHER", "teacher");
  const teacher = await prisma.teacher.findFirst({
    where: { userId: user.id, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!teacher) return { ok: false, message: "当前账号还没有关联在职教师档案。" };
  const kindRaw = String(formData.get("leaveKind") ?? "SICK");
  const leaveKind = kindRaw === "PERSONAL" ? "PERSONAL" as const : kindRaw === "SICK" ? "SICK" as const : null;
  if (!leaveKind) return { ok: false, message: "请选择事假或病假。" };
  const owned = await prisma.lessonStudent.findFirst({
    where: {
      id: lessonStudentId,
      organizationId: user.organizationId,
      attendanceStatus: "ABSENT",
      lessonSession: { teacherId: teacher.id, status: { not: "CANCELLED" } },
    },
    select: { id: true },
  });
  if (!owned) return { ok: false, message: "只能把自己课次上的缺勤转为请假并补课。" };
  try {
    const result = await prisma.$transaction(async (tx) =>
      convertAbsentToLeaveInTx(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        actorRole: "教师",
        lessonStudentId,
        leaveKind,
        note: String(formData.get("note") ?? "").trim() || null,
      }),
    );
    revalidatePath("/teacher");
    revalidatePath("/teacher/schedule");
    revalidatePath("/teacher/attendance");
    revalidatePath("/owner/attendance");
    revalidatePath("/owner/audit");
    revalidatePath("/parent/schedule");
    revalidatePath("/parent/attendance");
    revalidatePath("/owner/billing");
    return {
      ok: true,
      sourceId: result.sourceId,
      message: result.refunded
        ? `已改为${leaveKindLabel[leaveKind]}并退回1课时。请选择补课课次。`
        : `已改为${leaveKindLabel[leaveKind]}（未扣课时无需退回）。请选择补课课次。`,
    };
  } catch (error) {
    if (error instanceof CourseHourError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function scheduleTeacherMakeup(sourceId: string, formData: FormData): Promise<ActionResult & { warning?: string }> {
  const user = await requireRole("TEACHER", "teacher");
  const teacher = await prisma.teacher.findFirst({
    where: { userId: user.id, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!teacher) return { ok: false, message: "当前账号还没有关联在职教师档案。" };
  const targetLessonId = String(formData.get("targetLessonId") ?? "").trim();
  if (!targetLessonId) return { ok: false, message: "请选择一节已有课次。" };
  const source = await prisma.lessonStudent.findFirst({
    where: { id: sourceId, organizationId: user.organizationId, attendanceStatus: "LEAVE", lessonSession: { teacherId: teacher.id } },
    select: {
      id: true,
      studentId: true,
      seat: true,
      lessonSession: { select: { id: true, courseId: true, startAt: true, title: true, status: true } },
      student: { select: { name: true, status: true } },
    },
  });
  if (!source || source.lessonSession.status === "CANCELLED") return { ok: false, message: "只能给自己课次上的请假记录安排补课。" };
  if (source.student.status !== "ACTIVE") return { ok: false, message: "这名学生已停用，不能安排补课。" };
  const already = await prisma.lessonStudent.findFirst({
    where: { organizationId: user.organizationId, makeupSourceId: source.id },
    select: { id: true },
  });
  if (already) return { ok: false, message: "这次请假已经安排过补课。" };
  const target = await prisma.lessonSession.findFirst({
    where: { id: targetLessonId, organizationId: user.organizationId, teacherId: teacher.id, courseId: source.lessonSession.courseId, status: { not: "CANCELLED" } },
    select: {
      id: true,
      title: true,
      startAt: true,
      endAt: true,
      classGroupId: true,
      courseId: true,
      classroom: { select: { capacity: true, name: true } },
      students: { where: { studentId: source.studentId }, select: { id: true } },
      _count: { select: { students: true } },
    },
  });
  if (!target) return { ok: false, message: "只能补到你自己讲授的、同一门课、尚未取消的课次。" };
  if (target.id === source.lessonSession.id) return { ok: false, message: "不能补到原来请假的那一节。" };
  if (target.students.length > 0) return { ok: false, message: "这名学生已经在那节课的名单里。" };
  const overlap = await prisma.lessonSession.findFirst({
    where: {
      organizationId: user.organizationId,
      id: { not: target.id },
      status: { not: "CANCELLED" },
      startAt: { lt: target.endAt },
      endAt: { gt: target.startAt },
      students: { some: { studentId: source.studentId } },
    },
    select: { title: true },
  });
  const capacity = target.classroom?.capacity ?? null;
  const tooMany = capacity != null && target._count.students + 1 > capacity;
  if ((overlap || tooMany) && formData.get("acknowledgeConflict") !== "1") {
    const lines = [
      overlap ? `${source.student.name}在同一时间已有课次「${overlap.title ?? "课次"}」。` : "",
      tooMany ? `加入后有 ${target._count.students + 1} 人，教室「${target.classroom?.name ?? "教室"}」可坐 ${capacity} 人。` : "",
      "再次确认仍会加入。",
    ].filter(Boolean);
    return { ok: false, warning: lines.join("\n") };
  }
  const when = makeupLabel(source.lessonSession.startAt).replace(/^补 /, "");
  let created: string;
  try {
    created = await prisma.$transaction(async (tx) => {
      const row = await createMakeupRow(tx, {
        organizationId: user.organizationId,
        targetLessonId: target.id,
        classGroupId: target.classGroupId,
        courseId: target.courseId,
        studentId: source.studentId,
        studentName: source.student.name,
        sourceId: source.id,
        sourceSeat: source.seat,
        lastAction: `补 ${when}`,
      });
      await writeAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "MAKEUP_SCHEDULED",
        targetType: "LessonStudent",
        targetId: row.id,
        detail: `教师把${source.student.name}加入「${target.title ?? "课次"}」，补 ${when}`,
      });
      return row.id;
    });
  } catch (error) {
    if (error instanceof CourseHourError) return { ok: false, message: error.message };
    throw error;
  }
  await notifyMakeupArranged({
    organizationId: user.organizationId,
    studentId: source.studentId,
    targetTitle: target.title,
    targetStart: target.startAt,
    sourceStart: source.lessonSession.startAt,
    lessonStudentId: created,
  });
  refreshRoster();
  return { ok: true, message: "已加入补课课次。点名时按正常出勤扣课时，原来的请假不扣。" };
}

function moneyCents(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const cents = Math.round(Number(text) * 100);
  if (!Number.isFinite(cents) || cents > 99999999) return null;
  return cents;
}

function discountPercent(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return { ok: true as const, percent: null as number | null };
  const match = /^(\d+(?:\.\d{1,2})?)%$/.exec(text);
  if (!match) return { ok: false as const, percent: null };
  const percent = Number(match[1]);
  if (percent < 0 || percent > 100) return { ok: false as const, percent: null };
  return { ok: true as const, percent };
}

function calendarDate(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function convertTeacherTrial(lessonStudentId: string, formData: FormData): Promise<ActionResult> {
  const user = await requireRole("TEACHER", "teacher");
  const teacher = await prisma.teacher.findFirst({
    where: { userId: user.id, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true, name: true },
  });
  if (!teacher) return { ok: false, message: "当前账号还没有关联在职教师档案。" };
  const seat = await prisma.lessonStudent.findFirst({
    where: { id: lessonStudentId, organizationId: user.organizationId, seat: "TRIAL", lessonSession: { teacherId: teacher.id, status: { not: "CANCELLED" } } },
    select: {
      id: true,
      studentId: true,
      student: { select: { id: true, name: true, status: true, guardianName: true } },
      lessonSession: { select: { id: true, title: true, courseId: true, classGroupId: true, course: { select: { billingType: true, name: true, status: true } } } },
    },
  });
  if (!seat) return { ok: false, message: "只能把自己课次上、身份仍是试听的学生转为报名。" };
  if (seat.student.status !== "ACTIVE") return { ok: false, message: "这名学生已停用，不能转为报名。" };
  if (seat.lessonSession.course.status !== "ACTIVE") return { ok: false, message: "这门课已停用，不能报名。" };
  const phone = parseMainlandPhone(String(formData.get("guardianPhone") ?? ""), true);
  if (!phone.phone) return { ok: false, message: phone.error ?? "请填写联系人电话。" };
  const dueCents = moneyCents(formData.get("amountDue"));
  const paidCents = moneyCents(formData.get("amount"));
  const discount = discountPercent(formData.get("discountPercent"));
  if (dueCents === null || paidCents === null) return { ok: false, message: "应收和实收需要是 0 或正数，最多两位小数。" };
  if (!discount.ok) return { ok: false, message: "折扣率请填写百分数，例如 80%。留空表示没有折扣。" };
  const payMethod = String(formData.get("payMethod") ?? "") || "CASH";
  if (paidCents > 0 && !isPaymentMethod(payMethod)) return { ok: false, message: "请选择收款方式。" };
  const byPeriod = seat.lessonSession.course.billingType === "PER_PERIOD";
  const hours = Number(formData.get("hoursAdded"));
  const startDate = calendarDate(formData.get("startDate"));
  const endDate = calendarDate(formData.get("endDate"));
  if (!byPeriod && (!Number.isInteger(hours) || hours < 1 || hours > 500)) return { ok: false, message: "购买课时需要是 1 到 500 的整数。" };
  if (byPeriod && (!startDate || !endDate)) return { ok: false, message: "按周期课程请填写有效期。" };
  if (byPeriod && startDate && endDate && endDate.getTime() < startDate.getTime()) return { ok: false, message: "有效期结束时间不能早于开始时间。" };
  try {
    await prisma.$transaction(async (tx) => {
      const { convertTrialSeatsForCourses, findCourseEnrollment } = await import("@/lib/trial-convert");
      await tx.student.update({ where: { id: seat.student.id }, data: { guardianPhone: phone.phone } });
      const existing = await findCourseEnrollment(tx, {
        organizationId: user.organizationId,
        studentId: seat.student.id,
        courseId: seat.lessonSession.courseId,
      });
      let enrollmentId = existing?.id ?? null;
      if (!existing) {
        const enrollment = await tx.enrollment.create({
          data: {
            organizationId: user.organizationId,
            studentId: seat.student.id,
            courseId: seat.lessonSession.courseId,
            classGroupId: seat.lessonSession.classGroupId,
            amountDue: new Prisma.Decimal(dueCents).dividedBy(100),
            amount: new Prisma.Decimal(0),
            discountPercent: discount.percent == null ? null : new Prisma.Decimal(discount.percent),
            hoursAdded: byPeriod ? 0 : hours,
            startDate: byPeriod ? startDate : null,
            endDate: byPeriod ? endDate : null,
            status: enrollmentStanding(dueCents, 0, discount.percent),
            paidAt: null,
            createdById: user.id,
          },
          select: { id: true },
        });
        enrollmentId = enrollment.id;
        if (!byPeriod) {
          await creditCourseHours(tx, {
            organizationId: user.organizationId,
            studentId: seat.student.id,
            courseId: seat.lessonSession.courseId,
            hours,
          });
        }
      } else if (existing.classGroupId !== seat.lessonSession.classGroupId) {
        await tx.enrollment.update({
          where: { id: existing.id },
          data: { classGroupId: seat.lessonSession.classGroupId },
        });
      }
      await tx.classWaitlist.deleteMany({
        where: { organizationId: user.organizationId, studentId: seat.student.id, classGroupId: seat.lessonSession.classGroupId },
      });
      if (paidCents > 0 && enrollmentId) {
        await recordPayment(tx, {
          organizationId: user.organizationId,
          actorId: user.id,
          actorName: teacher.name,
          enrollmentId,
          amountCents: paidCents,
          method: isPaymentMethod(payMethod) ? payMethod : "CASH",
          paidAt: new Date(),
          reason: "试听转为报名",
          kind: "collect",
        });
      }
      const prior = await tx.renewalFollowUp.findFirst({
        where: { organizationId: user.organizationId, studentId: seat.student.id, courseId: seat.lessonSession.courseId, outcome: { not: "RENEWED" } },
        select: { id: true },
      });
      if (prior && !existing) {
        await tx.renewalFollowUp.create({
          data: {
            organizationId: user.organizationId,
            studentId: seat.student.id,
            courseId: seat.lessonSession.courseId,
            outcome: "RENEWED",
            note: "这门课又产生了新报名，跟进自动标为已续费。",
            createdById: user.id,
          },
        });
      }
      await convertTrialSeatsForCourses(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        studentId: seat.student.id,
        courseIds: [seat.lessonSession.courseId],
        primaryLessonStudentId: seat.id,
        detailPrefix: "教师把试听",
      });
    });
  } catch (error) {
    if (error instanceof CourseHourError) return { ok: false, message: error.message };
    throw error;
  }
  refreshRoster();
  revalidatePath("/owner/todos");
  return { ok: true, message: "已转为报名。这节课的身份改为已转正，不补扣试听课时。" };
}

async function currentTeacher() {
  const user = await requireRole("TEACHER", "teacher");
  const teacher = await prisma.teacher.findFirst({
    where: { userId: user.id, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  return { user, teacher };
}

export async function requestLessonChange(lessonId: string, formData: FormData): Promise<ActionResult> {
  const { user, teacher } = await currentTeacher();
  if (!teacher) return { ok: false, message: "当前账号还没有关联在职教师档案。" };
  const kind = String(formData.get("kind") ?? "");
  const note = String(formData.get("note") ?? "");
  if (kind === "RESCHEDULE") {
    const startAt = parseShanghaiDateTime(`${formData.get("startDate")}T${formData.get("startTime")}`);
    const endAt = parseShanghaiDateTime(`${formData.get("endDate")}T${formData.get("endTime")}`);
    const result = await submitLessonRequest({ organizationId: user.organizationId, userId: user.id, teacherId: teacher.id, lessonId, kind: "RESCHEDULE", startAt, endAt, note });
    revalidatePath("/teacher/schedule");
    revalidatePath("/owner/todos");
    return result;
  }
  if (kind === "SUBSTITUTE") {
    const result = await submitLessonRequest({
      organizationId: user.organizationId,
      userId: user.id,
      teacherId: teacher.id,
      lessonId,
      kind: "SUBSTITUTE",
      substituteTeacherId: String(formData.get("teacherId") ?? ""),
      note,
    });
    revalidatePath("/teacher/schedule");
    revalidatePath("/owner/todos");
    return result;
  }
  return { ok: false, message: "请选择调课或代课。" };
}

export async function withdrawLessonRequest(requestId: string): Promise<ActionResult> {
  const { user } = await currentTeacher();
  const result = await cancelLessonRequest({ organizationId: user.organizationId, userId: user.id, requestId });
  revalidatePath("/teacher/schedule");
  revalidatePath("/owner/todos");
  return result;
}
