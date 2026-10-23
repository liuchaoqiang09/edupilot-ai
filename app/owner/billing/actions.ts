"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { creditCourseHours } from "@/lib/course-hours";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseAge } from "@/lib/student-profile";

export type ActionResult = { ok: boolean; message?: string };

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
  const count = Number(formData.get("count"));
  if (!guardianName) return { ok: false, message: "请填写家长姓名。" };
  if (guardianName.length > 40) return { ok: false, message: "家长姓名不能超过 40 个字。" };
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

  const drafts: { courseId: string; classGroupId: string; dueCents: number; paidCents: number; hours: number; startDate: Date | null; endDate: Date | null }[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const label = `第 ${index + 1} 门`;
    const courseId = text(formData.get(`courseId:${index}`));
    const classGroupId = text(formData.get(`classGroupId:${index}`));
    const dueCents = money(formData.get(`amountDue:${index}`));
    const paidCents = money(formData.get(`amount:${index}`));
    const hours = Number(formData.get(`hoursAdded:${index}`));
    const startDate = calendarDate(formData.get(`startDate:${index}`));
    const endDate = calendarDate(formData.get(`endDate:${index}`));
    if (!courseId) return { ok: false, message: `${label}还没有选择课程。` };
    if (dueCents === null || paidCents === null) return { ok: false, message: `${label}的金额需要是 0 或正数，最多两位小数。` };
    const pair = `${courseId}:${classGroupId}`;
    if (seen.has(pair)) return { ok: false, message: `${label}和前面的课程、班级重复了。` };
    seen.add(pair);
    drafts.push({ courseId, classGroupId, dueCents, paidCents, hours, startDate, endDate });
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
      hours: draft.hours,
      byPeriod,
      startDate: draft.startDate,
      endDate: draft.endDate,
    });
  }

  await prisma.$transaction(async (tx) => {
    const student = existing ?? await tx.student.create({
      data: {
        organizationId: user.organizationId,
        name: newName,
        grade: newGrade || null,
        age: parsedAge.age,
        guardianName,
        studentNo: await nextStudentNo(tx, user.organizationId),
      },
      select: { id: true },
    });
    if (existing) {
      await tx.student.updateMany({
        where: { id: existing.id, organizationId: user.organizationId, OR: [{ guardianName: null }, { guardianName: "" }] },
        data: { guardianName },
      });
    }
    for (const line of lines) {
      const status = line.paidCents <= 0 ? "UNPAID" : line.paidCents >= line.dueCents ? "PAID" : "PARTIAL";
      await tx.enrollment.create({
        data: {
          organizationId: user.organizationId,
          studentId: student.id,
          courseId: line.courseId,
          classGroupId: line.classGroupId,
          amountDue: new Prisma.Decimal(line.dueCents).dividedBy(100),
          amount: new Prisma.Decimal(line.paidCents).dividedBy(100),
          hoursAdded: line.byPeriod ? 0 : line.hours,
          startDate: line.byPeriod ? line.startDate : null,
          endDate: line.byPeriod ? line.endDate : null,
          status,
          paidAt: line.paidCents > 0 ? new Date() : null,
          createdById: user.id,
        },
      });
      if (!line.byPeriod) {
        await creditCourseHours(tx, {
          organizationId: user.organizationId,
          studentId: student.id,
          courseId: line.courseId,
          hours: line.hours,
        });
      }
    }
  });

  revalidatePath("/owner/billing");
  revalidatePath("/owner/students");
  revalidatePath("/owner");
  revalidatePath("/owner/schedule");
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
