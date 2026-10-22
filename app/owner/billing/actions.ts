"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { creditCourseHours } from "@/lib/course-hours";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type ActionResult = { ok: boolean; message?: string };

function money(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const cents = Math.round(Number(text) * 100);
  if (!Number.isFinite(cents) || cents > 99999999) return null;
  return cents;
}

export async function createEnrollment(formData: FormData): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  const studentId = typeof formData.get("studentId") === "string" ? formData.get("studentId") : "";
  const courseId = typeof formData.get("courseId") === "string" ? formData.get("courseId") : "";
  const classGroupValue = formData.get("classGroupId");
  const classGroupId = typeof classGroupValue === "string" ? classGroupValue.trim() : "";
  const dueCents = money(formData.get("amountDue"));
  const paidCents = money(formData.get("amount"));
  const hours = Number(formData.get("hoursAdded"));
  const startDate = calendarDate(formData.get("startDate"));
  const endDate = calendarDate(formData.get("endDate"));
  if (!studentId || !courseId) return { ok: false, message: "请选择学员和课程。" };
  if (dueCents === null || paidCents === null) return { ok: false, message: "金额需要是 0 或正数，最多两位小数。" };

  const [student, course] = await Promise.all([
    prisma.student.findFirst({ where: { id: String(studentId), organizationId: user.organizationId, status: "ACTIVE" }, select: { id: true } }),
    prisma.course.findFirst({ where: { id: String(courseId), organizationId: user.organizationId, status: "ACTIVE" }, select: { id: true, billingType: true } }),
  ]);
  if (!student || !course) return { ok: false, message: "学员或课程不存在，或不属于当前机构。" };
  const classCount = await prisma.classGroup.count({ where: { organizationId: user.organizationId, courseId: course.id, status: "ACTIVE" } });
  const classGroup = classGroupId
    ? await prisma.classGroup.findFirst({ where: { id: classGroupId, organizationId: user.organizationId, courseId: course.id, status: "ACTIVE" }, select: { id: true } })
    : null;
  if (classGroupId && !classGroup) return { ok: false, message: "班级不存在，或不属于这门课程。" };
  if (!classGroup && classCount > 0) return { ok: false, message: "请选择报名班级。" };

  const byPeriod = course.billingType === "PER_PERIOD";
  if (!byPeriod && (!Number.isInteger(hours) || hours < 1 || hours > 500)) return { ok: false, message: "购买课时需要是 1 到 500 的整数。" };
  if (byPeriod && (!startDate || !endDate || endDate.getTime() < startDate.getTime())) {
    return { ok: false, message: "按周期报名需要填写有效期，结束日期不能早于开始日期。" };
  }

  const status = paidCents <= 0 ? "UNPAID" : paidCents >= dueCents ? "PAID" : "PARTIAL";
  await prisma.$transaction(async (tx) => {
    await tx.enrollment.create({
      data: {
        organizationId: user.organizationId,
        studentId: student.id,
        courseId: course.id,
        classGroupId: classGroup?.id ?? null,
        amountDue: new Prisma.Decimal(dueCents).dividedBy(100),
        amount: new Prisma.Decimal(paidCents).dividedBy(100),
        hoursAdded: byPeriod ? 0 : hours,
        startDate: byPeriod ? startDate : null,
        endDate: byPeriod ? endDate : null,
        status,
        paidAt: paidCents > 0 ? new Date() : null,
        createdById: user.id,
      },
    });
    if (!byPeriod) {
      await creditCourseHours(tx, {
        organizationId: user.organizationId,
        studentId: student.id,
        courseId: course.id,
        hours,
      });
    }
  });

  revalidatePath("/owner/billing");
  revalidatePath("/owner");
  revalidatePath("/owner/schedule");
  return { ok: true, message: byPeriod ? "已记录按周期报名。" : `已记录报名，并增加 ${hours} 课时。` };
}

function calendarDate(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
