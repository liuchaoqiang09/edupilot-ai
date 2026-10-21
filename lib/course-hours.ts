import { randomUUID } from "crypto";
import { AttendanceStatus, Prisma, PrismaClient } from "@prisma/client";

export const lowHourThreshold = 8;

export class CourseHourError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CourseHourError";
  }
}

type HourClient = Prisma.TransactionClient;

export async function creditCourseHours(
  tx: HourClient,
  input: { organizationId: string; studentId: string; courseId: string; hours: number },
) {
  if (!Number.isInteger(input.hours) || input.hours < 1) {
    throw new CourseHourError("增加的课时必须是正整数。");
  }
  await tx.$executeRaw`
    INSERT INTO "edupilot"."CourseHourBalance"
      ("id", "organizationId", "studentId", "courseId", "remainingHours", "createdAt", "updatedAt")
    VALUES (${randomUUID()}, ${input.organizationId}, ${input.studentId}, ${input.courseId}, ${input.hours}, NOW(), NOW())
    ON CONFLICT ("studentId", "courseId")
    DO UPDATE SET
      "remainingHours" = "edupilot"."CourseHourBalance"."remainingHours" + ${input.hours},
      "updatedAt" = NOW()
    WHERE "edupilot"."CourseHourBalance"."organizationId" = ${input.organizationId}
  `;
}

export async function syncAttendanceCharge(
  tx: HourClient,
  input: {
    organizationId: string;
    lessonStudentId: string;
    studentId: string;
    studentName: string;
    courseId: string;
    courseName: string;
    shouldCharge: boolean;
    billingType?: "PER_LESSON" | "PER_PERIOD";
    attendanceStatus: AttendanceStatus;
    attendanceNote: string | null;
  },
) {
  const note = input.attendanceNote;
  const shouldCharge = input.billingType === "PER_PERIOD" ? false : input.shouldCharge;
  if (shouldCharge) {
    const marked = await tx.lessonStudent.updateMany({
      where: { id: input.lessonStudentId, organizationId: input.organizationId, studentId: input.studentId, hoursCharged: false },
      data: {
        hoursCharged: true,
        attendanceStatus: input.attendanceStatus,
        attendanceNote: note,
        lastAction: "出勤扣减 1 课时",
      },
    });
    if (marked.count === 0) {
      const kept = await tx.lessonStudent.updateMany({
        where: { id: input.lessonStudentId, organizationId: input.organizationId, studentId: input.studentId, hoursCharged: true },
        data: { attendanceStatus: input.attendanceStatus, attendanceNote: note, lastAction: "更新考勤" },
      });
      if (kept.count !== 1) throw new CourseHourError("这节课的名单已变化，请刷新后再试。");
      return "unchanged" as const;
    }
    const deducted = await tx.courseHourBalance.updateMany({
      where: { organizationId: input.organizationId, studentId: input.studentId, courseId: input.courseId, remainingHours: { gte: 1 } },
      data: { remainingHours: { decrement: 1 } },
    });
    if (deducted.count !== 1) {
      throw new CourseHourError(`${input.studentName}在「${input.courseName}」的可用课时不足，这次考勤没有保存。`);
    }
    return "charged" as const;
  }

  const refunded = await tx.lessonStudent.updateMany({
    where: { id: input.lessonStudentId, organizationId: input.organizationId, studentId: input.studentId, hoursCharged: true },
    data: {
      hoursCharged: false,
      attendanceStatus: input.attendanceStatus,
      attendanceNote: note,
      lastAction: "撤销课时扣减",
    },
  });
  if (refunded.count === 1) {
    await creditCourseHours(tx, {
      organizationId: input.organizationId,
      studentId: input.studentId,
      courseId: input.courseId,
      hours: 1,
    });
    return "refunded" as const;
  }
  const kept = await tx.lessonStudent.updateMany({
    where: { id: input.lessonStudentId, organizationId: input.organizationId, studentId: input.studentId, hoursCharged: false },
    data: { attendanceStatus: input.attendanceStatus, attendanceNote: note, lastAction: "更新考勤" },
  });
  if (kept.count !== 1) throw new CourseHourError("这节课的名单已变化，请刷新后再试。");
  return "unchanged" as const;
}

export async function releaseChargedHour(
  tx: HourClient,
  input: { organizationId: string; lessonStudentId: string; studentId: string; courseId: string },
) {
  const released = await tx.lessonStudent.updateMany({
    where: { id: input.lessonStudentId, organizationId: input.organizationId, studentId: input.studentId, hoursCharged: true },
    data: { hoursCharged: false, lastAction: "移出名单退回 1 课时" },
  });
  if (released.count !== 1) return false;
  await creditCourseHours(tx, {
    organizationId: input.organizationId,
    studentId: input.studentId,
    courseId: input.courseId,
    hours: 1,
  });
  return true;
}

export async function findRenewingStudentIds(db: PrismaClient | Prisma.TransactionClient, organizationId: string) {
  const balances = await db.courseHourBalance.findMany({
    where: { organizationId, remainingHours: { lt: lowHourThreshold }, student: { status: "ACTIVE" } },
    select: { studentId: true, courseId: true },
  });
  if (balances.length === 0) return new Set<string>();
  const enrolled = await db.enrollment.findMany({
    where: { organizationId, OR: balances.map((row) => ({ studentId: row.studentId, courseId: row.courseId })) },
    select: { studentId: true, courseId: true },
  });
  const lowPairs = new Set(balances.map((row) => `${row.studentId}:${row.courseId}`));
  return new Set(enrolled.filter((row) => lowPairs.has(`${row.studentId}:${row.courseId}`)).map((row) => row.studentId));
}
