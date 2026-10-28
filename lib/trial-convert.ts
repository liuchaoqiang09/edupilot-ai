import type { Prisma, PrismaClient } from "@prisma/client";
import { writeAudit } from "@/lib/audit";

type Db = PrismaClient | Prisma.TransactionClient;

/** 同一学生同一课程是否已有报名（防止教师转正重复建报名）。 */
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

/** 把该生在这些课程上未取消课次的试听座位统一改为已转正。 */
export async function convertTrialSeatsForCourses(
  db: Db,
  input: {
    organizationId: string;
    actorId: string;
    studentId: string;
    courseIds: string[];
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
    select: { id: true, lessonSession: { select: { title: true } } },
  });
  if (trials.length === 0) return 0;
  await db.lessonStudent.updateMany({
    where: { id: { in: trials.map((row) => row.id) }, organizationId: input.organizationId, seat: "TRIAL" },
    data: { seat: "CONVERTED", lastAction: "试听转为报名" },
  });
  const prefix = input.detailPrefix ?? "试听";
  for (const row of trials) {
    await writeAudit(db, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "TRIAL_CONVERTED",
      targetType: "LessonStudent",
      targetId: row.id,
      detail: `${prefix}「${row.lessonSession.title ?? "课次"}」已转为报名`,
    });
  }
  return trials.length;
}
