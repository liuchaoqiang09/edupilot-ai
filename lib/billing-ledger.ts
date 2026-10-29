import { Prisma } from "@prisma/client";
import type { PaymentMethod } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { creditCourseHours, CourseHourError } from "@/lib/course-hours";
import { arrearsCents, decimalCents, enrollmentStanding, paymentMethodLabel } from "@/lib/enrollment-money";

type Ledger = Prisma.TransactionClient;

function yuan(cents: number) {
  return (Math.abs(cents) / 100).toFixed(2);
}

function decimalFromCents(cents: number) {
  return new Prisma.Decimal(cents).dividedBy(100);
}

async function lockEnrollment(tx: Ledger, organizationId: string, enrollmentId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "edupilot"."Enrollment"
    WHERE id = ${enrollmentId} AND "organizationId" = ${organizationId}
    FOR UPDATE
  `;
  if (rows.length !== 1) throw new CourseHourError("找不到这次报名。");
  return rows[0].id;
}

export async function refreshEnrollmentMoney(tx: Ledger, organizationId: string, enrollmentId: string) {
  const enrollment = await tx.enrollment.findFirst({
    where: { id: enrollmentId, organizationId },
    select: { id: true, amountDue: true, discountPercent: true },
  });
  if (!enrollment) throw new CourseHourError("找不到这次报名。");
  const payments = await tx.payment.findMany({
    where: { enrollmentId, organizationId, voidedAt: null },
    select: { amount: true, paidAt: true },
  });
  const netCents = payments.reduce((sum, payment) => sum + decimalCents(payment.amount), 0);
  const dueCents = decimalCents(enrollment.amountDue);
  const discount = enrollment.discountPercent == null ? null : Number(enrollment.discountPercent);
  const paidAt = payments.reduce<Date | null>((latest, payment) => (latest == null || payment.paidAt > latest ? payment.paidAt : latest), null);
  await tx.enrollment.update({
    where: { id: enrollment.id },
    data: {
      amount: decimalFromCents(netCents),
      status: enrollmentStanding(dueCents, netCents, discount),
      paidAt,
    },
  });
  return { dueCents, netCents, arrears: arrearsCents(dueCents, netCents, discount) };
}

export async function adjustLessonHours(
  tx: Ledger,
  input: {
    organizationId: string;
    actorId: string;
    actorName: string;
    studentId: string;
    courseId: string;
    deltaHours: number;
    reason: string;
  },
) {
  const course = await tx.course.findFirst({
    where: { id: input.courseId, organizationId: input.organizationId },
    select: { id: true, name: true, billingType: true },
  });
  if (!course) throw new CourseHourError("课程不存在，或不属于当前机构。");
  if (course.billingType !== "PER_LESSON") throw new CourseHourError("按周期的课程不能调整课时。");
  const student = await tx.student.findFirst({
    where: { id: input.studentId, organizationId: input.organizationId },
    select: { id: true, name: true },
  });
  if (!student) throw new CourseHourError("学员不存在，或不属于当前机构。");
  const enrolled = await tx.enrollment.findFirst({
    where: { organizationId: input.organizationId, studentId: student.id, courseId: course.id },
    select: { id: true },
  });
  if (!enrolled) throw new CourseHourError("这名学员还没有报名这门课。");
  if (!Number.isInteger(input.deltaHours) || input.deltaHours === 0 || Math.abs(input.deltaHours) > 500) {
    throw new CourseHourError("增减节数需要是 -500 到 500 之间、且不为 0 的整数。");
  }
  const reason = input.reason.trim();
  if (!reason || reason.length > 80) throw new CourseHourError("请填写 1 到 80 个字的原因。");

  if (input.deltaHours > 0) {
    await creditCourseHours(tx, {
      organizationId: input.organizationId,
      studentId: student.id,
      courseId: course.id,
      hours: input.deltaHours,
    });
  } else {
    const updated = await tx.courseHourBalance.updateMany({
      where: {
        organizationId: input.organizationId,
        studentId: student.id,
        courseId: course.id,
        remainingHours: { gte: -input.deltaHours },
      },
      data: { remainingHours: { increment: input.deltaHours } },
    });
    if (updated.count !== 1) throw new CourseHourError("减完后的课时不能小于 0。");
  }

  const adjustment = await tx.hourAdjustment.create({
    data: {
      organizationId: input.organizationId,
      studentId: student.id,
      courseId: course.id,
      deltaHours: input.deltaHours,
      reason,
      createdById: input.actorId,
    },
    select: { id: true },
  });
  const direction = input.deltaHours > 0 ? `增加 ${input.deltaHours} 节` : `减少 ${-input.deltaHours} 节`;
  await writeAudit(tx, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    action: "HOUR_ADJUST",
    targetType: "HourAdjustment",
    targetId: adjustment.id,
    detail: `${input.actorName}调整课时：${student.name}的${course.name}${direction}，原因：${reason}`,
  });
}

export async function recordPayment(
  tx: Ledger,
  input: {
    organizationId: string;
    actorId: string;
    actorName: string;
    enrollmentId: string;
    amountCents: number;
    method: PaymentMethod;
    paidAt: Date;
    reason: string;
    kind: "collect" | "refund";
  },
) {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > 99999999) {
    throw new CourseHourError("金额需要大于 0，最多两位小数。");
  }
  await lockEnrollment(tx, input.organizationId, input.enrollmentId);
  const enrollment = await tx.enrollment.findFirst({
    where: { id: input.enrollmentId, organizationId: input.organizationId },
    select: {
      id: true,
      student: { select: { name: true, status: true } },
      course: { select: { name: true } },
    },
  });
  if (!enrollment) throw new CourseHourError("找不到这次报名。");
  if (input.kind === "collect" && enrollment.student.status !== "ACTIVE") {
    throw new CourseHourError("学生已停用，不能再登记收款。如需退费请选退费。");
  }
  const reason = input.reason.trim();
  if (input.kind === "refund" && (!reason || reason.length > 80)) throw new CourseHourError("退费原因需要 1 到 80 个字。");
  if (reason.length > 80) throw new CourseHourError("说明不能超过 80 个字。");
  const signed = input.kind === "refund" ? -input.amountCents : input.amountCents;
  // 幂等放在报名行锁内，避免并发连点双收/双退。
  const recent = await tx.payment.findFirst({
    where: {
      organizationId: input.organizationId,
      enrollmentId: enrollment.id,
      createdById: input.actorId,
      voidedAt: null,
      amount: decimalFromCents(signed),
      createdAt: { gte: new Date(Date.now() - 8_000) },
    },
    select: { id: true },
  });
  if (recent) {
    throw new CourseHourError(input.kind === "refund" ? "刚才已经保存过相同的退费，没有重复写入。" : "刚才已经保存过相同的收款，没有重复写入。");
  }
  if (input.kind === "refund") {
    const open = await tx.payment.findMany({
      where: { enrollmentId: enrollment.id, organizationId: input.organizationId, voidedAt: null },
      select: { amount: true },
    });
    const net = open.reduce((sum, payment) => sum + decimalCents(payment.amount), 0);
    if (net + signed < 0) throw new CourseHourError("退费金额不能超过这门报名尚未作废的实收。");
  }
  const payment = await tx.payment.create({
    data: {
      organizationId: input.organizationId,
      enrollmentId: enrollment.id,
      amount: decimalFromCents(signed),
      method: input.method,
      paidAt: input.paidAt,
      reason: reason || null,
      createdById: input.actorId,
    },
    select: { id: true },
  });
  await refreshEnrollmentMoney(tx, input.organizationId, enrollment.id);
  const method = paymentMethodLabel[input.method];
  const detail = input.kind === "refund"
    ? `${input.actorName}退费：${enrollment.student.name}的${enrollment.course.name}退回 ${yuan(signed)} 元，${method}，原因：${reason}`
    : `${input.actorName}收款：${enrollment.student.name}的${enrollment.course.name}实收 ${yuan(signed)} 元，${method}`;
  await writeAudit(tx, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    action: input.kind === "refund" ? "PAYMENT_REFUND" : "PAYMENT_COLLECT",
    targetType: "Payment",
    targetId: payment.id,
    detail,
  });
  return payment.id;
}

export async function voidPayment(
  tx: Ledger,
  input: { organizationId: string; actorId: string; actorName: string; paymentId: string; reason: string },
) {
  const reason = input.reason.trim();
  if (!reason || reason.length > 80) throw new CourseHourError("作废原因需要 1 到 80 个字。");
  const payment = await tx.payment.findFirst({
    where: { id: input.paymentId, organizationId: input.organizationId },
    select: {
      id: true,
      amount: true,
      method: true,
      voidedAt: true,
      enrollmentId: true,
      enrollment: { select: { student: { select: { name: true } }, course: { select: { name: true } } } },
    },
  });
  if (!payment) throw new CourseHourError("找不到这笔收款。");
  if (payment.voidedAt) throw new CourseHourError("这笔收款已经作废。");
  await lockEnrollment(tx, input.organizationId, payment.enrollmentId);
  const open = await tx.payment.findMany({
    where: { enrollmentId: payment.enrollmentId, organizationId: input.organizationId, voidedAt: null, id: { not: payment.id } },
    select: { amount: true },
  });
  const net = open.reduce((sum, row) => sum + decimalCents(row.amount), 0);
  if (net < 0) throw new CourseHourError("作废后实收会小于 0，请先处理退费。");
  const marked = await tx.payment.updateMany({
    where: { id: payment.id, organizationId: input.organizationId, voidedAt: null },
    data: { voidedAt: new Date(), voidReason: reason },
  });
  if (marked.count !== 1) throw new CourseHourError("这笔收款已经作废。");
  await refreshEnrollmentMoney(tx, input.organizationId, payment.enrollmentId);
  const signed = decimalCents(payment.amount);
  const verb = signed < 0 ? "退费" : "收款";
  await writeAudit(tx, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    action: "PAYMENT_VOID",
    targetType: "Payment",
    targetId: payment.id,
    detail: `${input.actorName}作废${verb}：${payment.enrollment.student.name}的${payment.enrollment.course.name} ${yuan(signed)} 元，${paymentMethodLabel[payment.method]}，原因：${reason}`,
  });
}
