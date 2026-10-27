"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { recordPayment } from "@/lib/billing-ledger";
import { creditCourseHours, CourseHourError } from "@/lib/course-hours";
import { requireRole } from "@/lib/auth";
import { enrollmentStanding, isPaymentMethod } from "@/lib/enrollment-money";
import { prisma } from "@/lib/prisma";
import { parseAge, parseMainlandPhone } from "@/lib/student-profile";

export type ActionResult = { ok: boolean; message?: string };

function discountPercent(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return { ok: true as const, percent: null };
  const match = /^(\d+(?:\.\d{1,2})?)%$/.exec(text);
  if (!match) return { ok: false as const };
  const percent = Number(match[1]);
  if (percent < 0 || percent > 100) return { ok: false as const };
  return { ok: true as const, percent };
}

function money(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const cents = Math.round(Number(text) * 100);
  if (!Number.isFinite(cents) || cents > 99999999) return null;
  return cents;
}

type EnrollmentLine = {
  courseId: string;
  classGroupId: string | null;
  dueCents: number;
  paidCents: number;
  discountPercent: number | null;
  payMethod: "CASH" | "WECHAT" | "ALIPAY" | "BANK" | "OTHER";
  hours: number;
  byPeriod: boolean;
  startDate: Date | null;
  endDate: Date | null;
};

export async function createEnrollment(formData: FormData): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  const mode = formData.get("mode") === "existing" ? "existing" : "new";
  const studentId = text(formData.get("studentId"));
  const newName = text(formData.get("studentName"));
  const newGrade = text(formData.get("grade"));
  const parsedAge = parseAge(formData.get("age"));
  const guardianName = text(formData.get("guardianName"));
  const guardianPhone = parseMainlandPhone(text(formData.get("guardianPhone")), true);
  const count = Number(formData.get("count"));
  if (!guardianName) return { ok: false, message: "请填写家长姓名。" };
  if (guardianName.length > 40) return { ok: false, message: "家长姓名不能超过 40 个字。" };
  if (guardianPhone.error || !guardianPhone.phone) return { ok: false, message: guardianPhone.error ?? "请填写联系人电话。" };
  if (mode === "new") {
    if (!newName) return { ok: false, message: "请填写学生姓名。" };
    if (newName.length > 40) return { ok: false, message: "姓名不能超过 40 个字。" };
    if (newGrade.length > 40) return { ok: false, message: "年级不能超过 40 个字。" };
    if (parsedAge.error) return { ok: false, message: parsedAge.error };
  } else if (!studentId) {
    return { ok: false, message: "请选择学员。" };
  }
  if (!Number.isInteger(count) || count < 1 || count > 12) return { ok: false, message: "请至少添加一门课程，一次最多 12 门。" };

  const existing = mode === "existing"
    ? await prisma.student.findFirst({
        where: { id: studentId, organizationId: user.organizationId, status: "ACTIVE" },
        select: { id: true },
      })
    : null;
  if (mode === "existing" && !existing) return { ok: false, message: "学员不存在，或不属于当前机构。" };

  const drafts: { courseId: string; classGroupId: string; dueCents: number; paidCents: number; discountPercent: number | null; payMethod: EnrollmentLine["payMethod"]; hours: number; startDate: Date | null; endDate: Date | null }[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const label = `第 ${index + 1} 门`;
    const courseId = text(formData.get(`courseId:${index}`));
    const classGroupId = text(formData.get(`classGroupId:${index}`));
    const dueCents = money(formData.get(`amountDue:${index}`));
    const paidCents = money(formData.get(`amount:${index}`));
    const payMethod = text(formData.get(`payMethod:${index}`)) || "CASH";
    const discount = discountPercent(formData.get(`discountPercent:${index}`));
    const hours = Number(formData.get(`hoursAdded:${index}`));
    const startDate = calendarDate(formData.get(`startDate:${index}`));
    const endDate = calendarDate(formData.get(`endDate:${index}`));
    if (!courseId) return { ok: false, message: `${label}还没有选择课程。` };
    if (dueCents === null || paidCents === null) return { ok: false, message: `${label}的金额需要是 0 或正数，最多两位小数。` };
    if (!discount.ok) return { ok: false, message: `${label}的折扣率请填写百分数，例如 80%。` };
    if (paidCents !== null && paidCents > 0 && !isPaymentMethod(payMethod)) return { ok: false, message: `${label}请选择收款方式。` };
    const pair = `${courseId}:${classGroupId}`;
    if (seen.has(pair)) return { ok: false, message: `${label}和前面的课程、班级重复了。` };
    seen.add(pair);
    drafts.push({ courseId, classGroupId, dueCents, paidCents, discountPercent: discount.percent, payMethod: isPaymentMethod(payMethod) ? payMethod : "CASH", hours, startDate, endDate });
  }

  const courses = await prisma.course.findMany({
    where: { id: { in: drafts.map((line) => line.courseId) }, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true, billingType: true, classGroups: { where: { status: "ACTIVE" }, select: { id: true } } },
  });
  const courseById = new Map(courses.map((course) => [course.id, course]));
  const lines: EnrollmentLine[] = [];
  for (let index = 0; index < drafts.length; index += 1) {
    const draft = drafts[index];
    const label = `第 ${index + 1} 门`;
    const course = courseById.get(draft.courseId);
    if (!course) return { ok: false, message: `${label}的课程不存在，或不属于当前机构。` };
    const classGroup = draft.classGroupId ? course.classGroups.find((item) => item.id === draft.classGroupId) : null;
    if (!draft.classGroupId || !classGroup) return { ok: false, message: "请选择报名班级" };
    const byPeriod = course.billingType === "PER_PERIOD";
    if (!byPeriod && (!Number.isInteger(draft.hours) || draft.hours < 1 || draft.hours > 500)) {
      return { ok: false, message: `${label}的购买课时需要是 1 到 500 的整数。` };
    }
    if (byPeriod && (!draft.startDate || !draft.endDate)) {
      return { ok: false, message: `${label}是按周期课程，请填写有效期开始时间和有效期结束时间。` };
    }
    if (byPeriod && draft.startDate && draft.endDate && draft.endDate.getTime() < draft.startDate.getTime()) {
      return { ok: false, message: `${label}的有效期结束时间不能早于开始时间。` };
    }
    lines.push({
      courseId: course.id,
      classGroupId: classGroup?.id ?? null,
      dueCents: draft.dueCents,
      paidCents: draft.paidCents,
      discountPercent: draft.discountPercent,
      payMethod: draft.payMethod,
      hours: draft.hours,
      byPeriod,
      startDate: draft.startDate,
      endDate: draft.endDate,
    });
  }

  try {
  await prisma.$transaction(async (tx) => {
    const student = existing ?? await tx.student.create({
      data: {
        organizationId: user.organizationId,
        name: newName,
        grade: newGrade || null,
        age: parsedAge.age,
        guardianName,
        guardianPhone: guardianPhone.phone,
        studentNo: await nextStudentNo(tx, user.organizationId),
      },
      select: { id: true },
    });
    if (existing) {
      await tx.student.updateMany({
        where: { id: existing.id, organizationId: user.organizationId, OR: [{ guardianName: null }, { guardianName: "" }] },
        data: { guardianName },
      });
      await tx.student.updateMany({
        where: { id: existing.id, organizationId: user.organizationId },
        data: { guardianPhone: guardianPhone.phone },
      });
    }
    const recentCutoff = new Date(Date.now() - 8_000);
    for (const line of lines) {
      const duplicate = await tx.enrollment.findFirst({
        where: {
          organizationId: user.organizationId,
          studentId: student.id,
          courseId: line.courseId,
          classGroupId: line.classGroupId,
          createdById: user.id,
          hoursAdded: line.byPeriod ? 0 : line.hours,
          createdAt: { gte: recentCutoff },
        },
        select: { id: true },
      });
      if (duplicate) throw new CourseHourError("刚才已经保存过相同的报名，没有重复写入。请刷新后核对。");
      const enrollment = await tx.enrollment.create({
        data: {
          organizationId: user.organizationId,
          studentId: student.id,
          courseId: line.courseId,
          classGroupId: line.classGroupId,
          amountDue: new Prisma.Decimal(line.dueCents).dividedBy(100),
          amount: new Prisma.Decimal(0),
          discountPercent: line.discountPercent == null ? null : new Prisma.Decimal(line.discountPercent),
          hoursAdded: line.byPeriod ? 0 : line.hours,
          startDate: line.byPeriod ? line.startDate : null,
          endDate: line.byPeriod ? line.endDate : null,
          status: enrollmentStanding(line.dueCents, 0, line.discountPercent),
          paidAt: null,
          createdById: user.id,
        },
        select: { id: true },
      });
      if (line.classGroupId) {
        await tx.classWaitlist.deleteMany({
          where: { organizationId: user.organizationId, studentId: student.id, classGroupId: line.classGroupId },
        });
      }
      if (line.paidCents > 0) {
        await recordPayment(tx, {
          organizationId: user.organizationId,
          actorId: user.id,
          actorName: user.name,
          enrollmentId: enrollment.id,
          amountCents: line.paidCents,
          method: line.payMethod,
          paidAt: new Date(),
          reason: "",
          kind: "collect",
        });
      }
      if (!line.byPeriod) {
        await creditCourseHours(tx, {
          organizationId: user.organizationId,
          studentId: student.id,
          courseId: line.courseId,
          hours: line.hours,
        });
      }
      const priorFollowUp = await tx.renewalFollowUp.findFirst({
        where: { organizationId: user.organizationId, studentId: student.id, courseId: line.courseId, outcome: { not: "RENEWED" } },
        select: { id: true },
      });
      if (priorFollowUp) {
        await tx.renewalFollowUp.create({
          data: {
            organizationId: user.organizationId,
            studentId: student.id,
            courseId: line.courseId,
            outcome: "RENEWED",
            note: "这门课又产生了新报名，跟进自动标为已续费。",
            createdById: user.id,
          },
        });
      }
    }
    const courseIds = [...new Set(lines.map((line) => line.courseId))];
    const converted = await tx.lessonStudent.findMany({
      where: {
        organizationId: user.organizationId,
        studentId: student.id,
        seat: "TRIAL",
        lessonSession: { courseId: { in: courseIds }, status: { not: "CANCELLED" } },
      },
      select: { id: true, lessonSession: { select: { title: true } } },
    });
    if (converted.length > 0) {
      await tx.lessonStudent.updateMany({
        where: { id: { in: converted.map((row) => row.id) }, organizationId: user.organizationId, seat: "TRIAL" },
        data: { seat: "CONVERTED", lastAction: "试听转为报名" },
      });
      for (const row of converted) {
        await writeAudit(tx, {
          organizationId: user.organizationId,
          actorId: user.id,
          action: "TRIAL_CONVERTED",
          targetType: "LessonStudent",
          targetId: row.id,
          detail: `试听「${row.lessonSession.title ?? "课次"}」已转为报名`,
        });
      }
    }
  });
  } catch (error) {
    if (error instanceof CourseHourError) return { ok: false, message: error.message };
    throw error;
  }

  revalidatePath("/owner/billing");
  revalidatePath("/owner/students");
  revalidatePath("/owner");
  revalidatePath("/owner/schedule");
  revalidatePath("/owner/audit");
  const periodCount = lines.filter((line) => line.byPeriod).length;
  const lessonCount = lines.length - periodCount;
  const parts = [mode === "new" ? `已建立学生档案，并记录 ${lines.length} 门报名` : `已记录 ${lines.length} 门报名`];
  if (lessonCount > 0) parts.push(`按课时 ${lessonCount} 门`);
  if (periodCount > 0) parts.push(`按周期 ${periodCount} 门`);
  return { ok: true, message: `${parts.join("，")}。` };
}

async function nextStudentNo(tx: Prisma.TransactionClient, organizationId: string) {
  const rows = await tx.student.findMany({
    where: { organizationId },
    select: { studentNo: true },
  });
  let max = 0;
  for (const row of rows) {
    const match = /^STU-(\d+)$/.exec(row.studentNo ?? "");
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `STU-${String(max + 1).padStart(4, "0")}`;
}

function text(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function calendarDate(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
