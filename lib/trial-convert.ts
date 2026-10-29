import type { Prisma, PrismaClient } from "@prisma/client";
import { writeAudit } from "@/lib/audit";

type Db = PrismaClient | Prisma.TransactionClient;

/** 同一学生同一课程是否已有报名（防止教师转正重复建档）。 */
export async function findCourseEnrollment(
  db: Db,
  input: { organizationId: string; studentId: string; courseId: string },
) {
  return db.enrollment.findFirst({
    where: {
      organizationId: input.organizationId,
      studentId: input.studentId,
      courseId: input.courseId,
    },
    select: { id: true, classGroupId: true },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * 试听转正后的名单处理：
 * - 触发课次（primaryLessonStudentId）以及已经上过的试听 → CONVERTED（本课不补扣）
 * - 尚未开始的其他试听 → ENROLLED（后续出勤按在读扣课）
 */
export async function convertTrialSeatsForCourses(
  db: Db,
  input: {
    organizationId: string;
    actorId: string;
    studentId: string;
    courseIds: string[];
    primaryLessonStudentId?: string;
    detailPrefix?: string;
  },
) {
  if (input.courseIds.length === 0) return 0;
  const trials = await db.lessonStudent.findMany({
    where: {
      organizationId: input.organizationId,
      studentId: input.studentId,
      seat: "TRIAL",
      lessonSession: { courseId: { in: input.courseIds }, status: { not: "CANCELLED" } },
    },
    select: {
      id: true,
      lessonSession: { select: { title: true, startAt: true } },
    },
  });
  if (trials.length === 0) return 0;
  const now = Date.now();
  const convertedIds: string[] = [];
  const enrolledIds: string[] = [];
  for (const row of trials) {
    const isPrimary = input.primaryLessonStudentId != null && row.id === input.primaryLessonStudentId;
    const started = row.lessonSession.startAt.getTime() <= now;
    if (isPrimary || started) convertedIds.push(row.id);
    else enrolledIds.push(row.id);
  }
  const prefix = input.detailPrefix ?? "试听";
  if (convertedIds.length > 0) {
    await db.lessonStudent.updateMany({
      where: { id: { in: convertedIds }, organizationId: input.organizationId, seat: "TRIAL" },
      data: { seat: "CONVERTED", lastAction: "试听转为报名" },
    });
    for (const row of trials.filter((item) => convertedIds.includes(item.id))) {
      await writeAudit(db, {
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: "TRIAL_CONVERTED",
        targetType: "LessonStudent",
        targetId: row.id,
        detail: `${prefix}「${row.lessonSession.title ?? "课次"}」已转为报名`,
      });
    }
  }
  if (enrolledIds.length > 0) {
    await db.lessonStudent.updateMany({
      where: { id: { in: enrolledIds }, organizationId: input.organizationId, seat: "TRIAL" },
      data: { seat: "ENROLLED", lastAction: "报名后未来试听改为在读" },
    });
    for (const row of trials.filter((item) => enrolledIds.includes(item.id))) {
      await writeAudit(db, {
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: "TRIAL_CONVERTED",
        targetType: "LessonStudent",
        targetId: row.id,
        detail: `${prefix}「${row.lessonSession.title ?? "课次"}」报名后改为在读，后续出勤按课时扣减`,
      });
    }
  }
  return convertedIds.length + enrolledIds.length;
}
