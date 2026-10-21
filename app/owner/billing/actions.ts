"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
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
  const dueCents = money(formData.get("amountDue"));
  const paidCents = money(formData.get("amount"));
  const hours = Number(formData.get("hoursAdded"));
  if (!studentId || !courseId) return { ok: false, message: "请选择学员和课程。" };
  if (dueCents === null || paidCents === null) return { ok: false, message: "金额需要是 0 或正数，最多两位小数。" };
  if (!Number.isInteger(hours) || hours < 1 || hours > 500) return { ok: false, message: "购买课时需要是 1 到 500 的整数。" };

  const [student, course] = await Promise.all([
    prisma.student.findFirst({ where: { id: String(studentId), organizationId: user.organizationId, status: "ACTIVE" }, select: { id: true } }),
    prisma.course.findFirst({ where: { id: String(courseId), organizationId: user.organizationId, status: "ACTIVE" }, select: { id: true } }),
  ]);
  if (!student || !course) return { ok: false, message: "学员或课程不存在，或不属于当前机构。" };

  const status = paidCents <= 0 ? "UNPAID" : paidCents >= dueCents ? "PAID" : "PARTIAL";
  await prisma.$transaction([
    prisma.enrollment.create({
      data: {
        organizationId: user.organizationId,
        studentId: student.id,
        courseId: course.id,
        amountDue: new Prisma.Decimal(dueCents).dividedBy(100),
        amount: new Prisma.Decimal(paidCents).dividedBy(100),
        hoursAdded: hours,
        status,
        paidAt: paidCents > 0 ? new Date() : null,
        createdById: user.id,
      },
    }),
    prisma.student.updateMany({
      where: { id: student.id, organizationId: user.organizationId },
      data: { remainingHours: { increment: hours } },
    }),
  ]);

  revalidatePath("/owner/billing");
  revalidatePath("/owner");
  return { ok: true, message: `已记录报名，并增加 ${hours} 课时。` };
}
