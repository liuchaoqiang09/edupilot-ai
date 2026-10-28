import type { Prisma, PrismaClient } from "@prisma/client";
import { CourseHourError } from "@/lib/course-hours";
import { resolveLessonSeat } from "@/lib/lesson-seat-rules";

type Db = PrismaClient | Prisma.TransactionClient;

/** 一条请假最多补一次；依赖应用层检查 + DB unique(makeupSourceId)。 */
export async function assertMakeupSourceAvailable(db: Db, organizationId: string, sourceId: string) {
  const already = await db.lessonStudent.findFirst({
    where: { organizationId, makeupSourceId: sourceId },
    select: { id: true },
  });
  if (already) throw new CourseHourError("这次请假已经安排过补课。");
}

/** 已安排补课的请假不能先移出。 */
export async function assertLeaveRemovable(db: Db, lessonStudentId: string) {
  const locked = await db.lessonStudent.findFirst({
    where: { id: lessonStudentId },
    select: { makeups: { select: { id: true }, take: 1 } },
  });
  if (locked?.makeups.length) {
    throw new CourseHourError("这次请假已经安排了补课。先处理补课名单，再移出这次请假。");
  }
}

/**
 * 补课座位：按临时规则校验（须已报名该课程）；试听请假无法按临时补时抛错。
 */
export async function resolveMakeupSeat(
  db: Db,
  input: {
    organizationId: string;
    studentId: string;
    studentName: string;
    courseId: string;
    classGroupId: string;
  },
) {
  return resolveLessonSeat(db, { ...input, requested: "GUEST" });
}

export async function createMakeupRow(
  db: Db,
  input: {
    organizationId: string;
    targetLessonId: string;
    classGroupId: string;
    courseId: string;
    studentId: string;
    studentName: string;
    sourceId: string;
    lastAction: string;
  },
) {
  await assertMakeupSourceAvailable(db, input.organizationId, input.sourceId);
  const seat = await resolveMakeupSeat(db, {
    organizationId: input.organizationId,
    studentId: input.studentId,
    studentName: input.studentName,
    courseId: input.courseId,
    classGroupId: input.classGroupId,
  });
  return db.lessonStudent.create({
    data: {
      organizationId: input.organizationId,
      lessonSessionId: input.targetLessonId,
      studentId: input.studentId,
      seat: seat.seat,
      makeupSourceId: input.sourceId,
      lastAction: input.lastAction || seat.lastAction,
    },
    select: { id: true },
  });
}
