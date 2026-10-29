"use server";

import { revalidatePath } from "next/cache";
import { adjustLessonHours, recordPayment, voidPayment } from "@/lib/billing-ledger";
import { requireRole } from "@/lib/auth";
import { CourseHourError } from "@/lib/course-hours";
import { parseShanghaiDateTime } from "@/lib/datetime";
import { isPaymentMethod } from "@/lib/enrollment-money";
import { prisma } from "@/lib/prisma";

export type LedgerResult = { ok: boolean; message?: string };

function refresh() {
  revalidatePath("/owner/billing");
  revalidatePath("/owner/students");
  revalidatePath("/owner");
  revalidatePath("/owner/audit");
}

function moneyCents(value: string) {
  const text = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const cents = Math.round(Number(text) * 100);
  if (!Number.isFinite(cents) || cents <= 0 || cents > 99999999) return null;
  return cents;
}

export async function adjustHours(formData: FormData): Promise<LedgerResult> {
  const user = await requireRole("OWNER", "owner");
  const studentId = text(formData.get("studentId"));
  const courseId = text(formData.get("courseId"));
  const delta = Number(formData.get("deltaHours"));
  const reason = text(formData.get("reason"));
  try {
    await prisma.$transaction((tx) => adjustLessonHours(tx, {
      organizationId: user.organizationId,
      actorId: user.id,
      actorName: user.name,
      studentId,
      courseId,
      deltaHours: delta,
      reason,
    }));
  } catch (error) {
    return { ok: false, message: error instanceof CourseHourError ? error.message : "课时没有调整，请刷新后再试。" };
  }
  refresh();
  return { ok: true, message: "课时已调整。" };
}

export async function collectPayment(formData: FormData): Promise<LedgerResult> {
  return savePayment(formData, "collect");
}

export async function refundPayment(formData: FormData): Promise<LedgerResult> {
  return savePayment(formData, "refund");
}

async function savePayment(formData: FormData, kind: "collect" | "refund"): Promise<LedgerResult> {
  const user = await requireRole("OWNER", "owner");
  const method = text(formData.get("method"));
  const paidAt = parseShanghaiDateTime(text(formData.get("paidAt"))) ?? new Date();
  const cents = moneyCents(text(formData.get("amount")));
  const enrollmentId = text(formData.get("enrollmentId"));
  const reason = text(formData.get("reason"));
  if (!isPaymentMethod(method)) return { ok: false, message: "请选择收款方式。" };
  if (cents == null) return { ok: false, message: "金额需要大于 0，最多两位小数。" };
  try {
    await prisma.$transaction(async (tx) => {
      await recordPayment(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        actorName: user.name,
        enrollmentId,
        amountCents: cents,
        method,
        paidAt,
        reason,
        kind,
      });
    });
  } catch (error) {
    return { ok: false, message: error instanceof CourseHourError ? error.message : "没有保存，请刷新后再试。" };
  }
  refresh();
  return { ok: true, message: kind === "refund" ? "退费已记录。" : "收款已记录。" };
}

export async function voidCollectedPayment(formData: FormData): Promise<LedgerResult> {
  const user = await requireRole("OWNER", "owner");
  try {
    await prisma.$transaction((tx) => voidPayment(tx, {
      organizationId: user.organizationId,
      actorId: user.id,
      actorName: user.name,
      paymentId: text(formData.get("paymentId")),
      reason: text(formData.get("reason")),
    }));
  } catch (error) {
    return { ok: false, message: error instanceof CourseHourError ? error.message : "没有作废，请刷新后再试。" };
  }
  refresh();
  return { ok: true, message: "这笔流水已作废，不再计入实收。" };
}

function text(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}
