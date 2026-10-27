"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth";
import { CourseHourError } from "@/lib/course-hours";
import { formatMonthDay, shanghaiDateKey } from "@/lib/datetime";
import { convertAbsentToLeaveInTx, leaveKindLabel } from "@/lib/leave-kind";
import { notifyMakeupArranged } from "@/lib/parent-notice";
import { prisma } from "@/lib/prisma";

export type MakeupResult = { ok: boolean; message?: string; sourceId?: string };

export async function convertAbsentToLeaveForMakeup(lessonStudentId: string, formData: FormData): Promise<MakeupResult> {
  const user = await requireRole("OWNER", "owner");
  const kindRaw = String(formData.get("leaveKind") ?? "SICK");
  const leaveKind = kindRaw === "PERSONAL" ? "PERSONAL" as const : kindRaw === "SICK" ? "SICK" as const : null;
  if (!leaveKind) return { ok: false, message: "请选择事假或病假。" };
  const owned = await prisma.lessonStudent.findFirst({
    where: { id: lessonStudentId, organizationId: user.organizationId, attendanceStatus: "ABSENT" },
    select: { id: true },
  });
  if (!owned) return { ok: false, message: "只能把缺勤记录转为请假并补课。" };
  try {
    const result = await prisma.$transaction(async (tx) =>
      convertAbsentToLeaveInTx(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        actorRole: "负责人",
        lessonStudentId,
        leaveKind,
        note: String(formData.get("note") ?? "").trim() || null,
      }),
    );
    revalidatePath("/owner/attendance");
    revalidatePath("/owner/schedule");
    revalidatePath("/owner/audit");
    revalidatePath("/owner/billing");
    revalidatePath("/teacher");
    revalidatePath("/teacher/schedule");
    revalidatePath("/parent/schedule");
    revalidatePath("/parent/attendance");
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

export async function scheduleMakeup(sourceId: string, formData: FormData): Promise<MakeupResult> {
  const user = await requireRole("OWNER", "owner");
  const targetLessonId = typeof formData.get("targetLessonId") === "string" ? formData.get("targetLessonId")!.toString().trim() : "";
  if (!targetLessonId) return { ok: false, message: "请选择一节已有课次。" };
  const source = await prisma.lessonStudent.findFirst({
    where: { id: sourceId, organizationId: user.organizationId, attendanceStatus: "LEAVE" },
    select: {
      id: true,
      studentId: true,
      lessonSession: { select: { id: true, courseId: true, startAt: true, title: true, status: true } },
      student: { select: { name: true } },
    },
  });
  if (!source || source.lessonSession.status === "CANCELLED") return { ok: false, message: "只能给请假记录安排补课。" };
  const already = await prisma.lessonStudent.findFirst({
    where: { organizationId: user.organizationId, makeupSourceId: source.id },
    select: { id: true },
  });
  if (already) return { ok: false, message: "这次请假已经安排过补课。" };
  const target = await prisma.lessonSession.findFirst({
    where: { id: targetLessonId, organizationId: user.organizationId, courseId: source.lessonSession.courseId, status: { not: "CANCELLED" } },
    select: { id: true, title: true, startAt: true, students: { where: { studentId: source.studentId }, select: { id: true } } },
  });
  if (!target) return { ok: false, message: "请选择同一门课、尚未取消的课次。" };
  if (target.id === source.lessonSession.id) return { ok: false, message: "不能补到原来请假的那一节。" };
  if (target.students.length > 0) return { ok: false, message: "这名学生已经在那节课的名单里。" };
  const when = formatMonthDay(shanghaiDateKey(source.lessonSession.startAt));
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.lessonStudent.create({
      data: {
        organizationId: user.organizationId,
        lessonSessionId: target.id,
        studentId: source.studentId,
        seat: "GUEST",
        makeupSourceId: source.id,
        lastAction: `补 ${when}的请假`,
      },
      select: { id: true },
    });
    await writeAudit(tx, {
      organizationId: user.organizationId,
      actorId: user.id,
      action: "MAKEUP_SCHEDULED",
      targetType: "LessonStudent",
      targetId: row.id,
      detail: `把${source.student.name}加入「${target.title ?? "课次"}」，补 ${when}的请假`,
    });
    return row.id;
  });
  await notifyMakeupArranged({
    organizationId: user.organizationId,
    studentId: source.studentId,
    targetTitle: target.title,
    targetStart: target.startAt,
    sourceStart: source.lessonSession.startAt,
    lessonStudentId: created,
  });
  revalidatePath("/owner/attendance");
  revalidatePath("/owner/schedule");
  revalidatePath("/teacher");
  revalidatePath("/owner/audit");
  return { ok: true, message: "已加入补课课次。点名时按正常出勤扣课时，原来的请假不扣。" };
}

export async function recordRenewalFollowUp(studentId: string, courseId: string, formData: FormData) {
  const user = await requireRole("OWNER", "owner");
  const outcome = typeof formData.get("outcome") === "string" ? formData.get("outcome")!.toString() : "";
  if (!["TO_CONTACT", "CONTACTED", "NEXT_BOOKED", "DECLINED"].includes(outcome)) {
    return { ok: false, message: "请选择跟进结果。" };
  }
  const note = typeof formData.get("note") === "string" ? formData.get("note")!.toString().trim().slice(0, 200) : "";
  const nextRaw = typeof formData.get("nextContactOn") === "string" ? formData.get("nextContactOn")!.toString().trim() : "";
  const nextContactOn = /^\d{4}-\d{2}-\d{2}$/.test(nextRaw) ? new Date(`${nextRaw}T00:00:00.000Z`) : null;
  const student = await prisma.student.findFirst({
    where: { id: studentId, organizationId: user.organizationId },
    select: { id: true },
  });
  const course = await prisma.course.findFirst({
    where: { id: courseId, organizationId: user.organizationId },
    select: { id: true },
  });
  if (!student || !course) return { ok: false, message: "学生或课程不属于当前机构。" };
  await prisma.renewalFollowUp.create({
    data: {
      organizationId: user.organizationId,
      studentId,
      courseId,
      outcome: outcome as "TO_CONTACT" | "CONTACTED" | "NEXT_BOOKED" | "DECLINED",
      note: note || null,
      nextContactOn,
      createdById: user.id,
    },
  });
  revalidatePath("/owner/billing");
  return { ok: true, message: "跟进已记录。" };
}
