import type { Prisma, PrismaClient } from "@prisma/client";
import { CourseHourError } from "@/lib/course-hours";

export type LessonSeatKind = "ENROLLED" | "GUEST" | "TRIAL";

type Db = PrismaClient | Prisma.TransactionClient;

export function seatLastAction(seat: LessonSeatKind) {
  if (seat === "TRIAL") return "加入试听";
  if (seat === "GUEST") return "临时加入";
  return "加入课次";
}

export function normalizeRequestedSeat(value: string | null | undefined): LessonSeatKind {
  if (value === "TRIAL" || value === "GUEST" || value === "ENROLLED") return value;
  return "ENROLLED";
}

/**
 * 本班：必须有该课程且班级与课次一致的报名。
 * 临时/跨班：必须有该课程报名（班级可不同）。
 * 试听：可不报名。
 */
export async function resolveLessonSeat(
  db: Db,
  input: {
    organizationId: string;
    studentId: string;
    studentName: string;
    courseId: string;
    classGroupId: string;
    requested: string | null | undefined;
  },
): Promise<{ seat: LessonSeatKind; lastAction: string }> {
  const requested = normalizeRequestedSeat(input.requested);

  const enrollments = await db.enrollment.findMany({
    where: {
      organizationId: input.organizationId,
      studentId: input.studentId,
      courseId: input.courseId,
      student: { status: "ACTIVE" },
    },
    select: { classGroupId: true },
  });
  const inThisClass = enrollments.some((row) => row.classGroupId === input.classGroupId);
  const inCourse = enrollments.length > 0;

  if (requested === "TRIAL") {
    if (inCourse) {
      throw new CourseHourError(
        `${input.studentName}已报名该课程，不能再按试听加入。本班请选「本班」，跨班请选「临时」。`,
      );
    }
    return { seat: "TRIAL", lastAction: seatLastAction("TRIAL") };
  }

  if (requested === "ENROLLED") {
    if (inThisClass) return { seat: "ENROLLED", lastAction: seatLastAction("ENROLLED") };
    if (inCourse) {
      throw new CourseHourError(
        `${input.studentName}已报名该课程的其他班。合班或跨班请选「临时」，或先办理转班后再按本班加入。`,
      );
    }
    throw new CourseHourError(
      `${input.studentName}未报名该课程，不能按本班加入。请先报名，或选「试听」。`,
    );
  }

  // GUEST
  if (!inCourse) {
    throw new CourseHourError(
      `${input.studentName}未报名该课程，不能按临时加入。未报名请选「试听」。`,
    );
  }
  return { seat: "GUEST", lastAction: seatLastAction("GUEST") };
}

/** 教师/助教：本班报名自动本班；否则必须明确试听或临时，并走同一套校验。 */
export async function resolveTeacherAddSeat(
  db: Db,
  input: {
    organizationId: string;
    studentId: string;
    studentName: string;
    courseId: string;
    classGroupId: string;
    requested: string | null | undefined;
  },
) {
  const inThisClass = await db.enrollment.findFirst({
    where: {
      organizationId: input.organizationId,
      studentId: input.studentId,
      classGroupId: input.classGroupId,
      student: { status: "ACTIVE" },
    },
    select: { id: true },
  });
  if (inThisClass) {
    return { seat: "ENROLLED" as const, lastAction: seatLastAction("ENROLLED"), forcedClass: true };
  }
  if (input.requested !== "TRIAL" && input.requested !== "GUEST") {
    throw new CourseHourError("不是本班学生时，请选择临时或试听。");
  }
  const resolved = await resolveLessonSeat(db, {
    ...input,
    requested: input.requested,
  });
  return { ...resolved, forcedClass: false };
}

/**
 * 清理未扣费、未认真点名的错误「本班」名单（含未开始课，以及已过点仍为未标记的 SCHEDULED）：
 * - 无该课程报名 → 移出
 * - 有课程报名但班级不符 → 改为临时（跨班）
 * 已扣课时或已点出勤/缺勤/迟到的历史不改。
 */
export async function repairInvalidEnrolledSeats(db: Db, organizationId?: string) {
  const rows = await db.lessonStudent.findMany({
    where: {
      seat: "ENROLLED",
      hoursCharged: false,
      attendanceStatus: { in: ["NOT_MARKED", "LEAVE"] },
      ...(organizationId ? { organizationId } : {}),
      lessonSession: { status: "SCHEDULED" },
    },
    select: {
      id: true,
      organizationId: true,
      studentId: true,
      lessonSession: { select: { courseId: true, classGroupId: true } },
    },
  });
  let removed = 0;
  let converted = 0;
  for (const row of rows) {
    const enrollments = await db.enrollment.findMany({
      where: {
        organizationId: row.organizationId,
        studentId: row.studentId,
        courseId: row.lessonSession.courseId,
        student: { status: "ACTIVE" },
      },
      select: { classGroupId: true },
    });
    const inClass = enrollments.some((item) => item.classGroupId === row.lessonSession.classGroupId);
    if (inClass) continue;
    if (enrollments.length > 0) {
      const updated = await db.lessonStudent.updateMany({
        where: { id: row.id, seat: "ENROLLED", hoursCharged: false },
        data: { seat: "GUEST", lastAction: "跨班修正为临时" },
      });
      if (updated.count === 1) converted += 1;
    } else {
      const locked = await db.lessonStudent.findFirst({
        where: { id: row.id },
        select: { makeups: { select: { id: true }, take: 1 } },
      });
      if (locked?.makeups.length) continue;
      const deleted = await db.lessonStudent.deleteMany({ where: { id: row.id, seat: "ENROLLED", hoursCharged: false } });
      if (deleted.count === 1) removed += 1;
    }
  }
  return { scanned: rows.length, removed, converted };
}
