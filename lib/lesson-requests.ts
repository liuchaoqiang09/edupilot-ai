import { writeAudit } from "@/lib/audit";
import { formatClock, formatDateTime } from "@/lib/datetime";
import { findScheduleConflicts, singleConflictWarning, type ExistingLesson } from "@/lib/lesson-conflicts";
import { notifyLessonChange } from "@/lib/parent-notice";
import { prisma } from "@/lib/prisma";

async function windowLessons(organizationId: string, startAt: Date, endAt: Date, studentIds: string[], ignoreId: string): Promise<ExistingLesson[]> {
  const rows = await prisma.lessonSession.findMany({
    where: { organizationId, status: { not: "CANCELLED" }, startAt: { lt: endAt }, endAt: { gt: startAt }, id: { not: ignoreId } },
    select: {
      id: true, title: true, startAt: true, endAt: true, teacherId: true, classGroupId: true, location: true, classroomId: true,
      students: { where: { studentId: { in: studentIds.length > 0 ? studentIds : ["__none__"] } }, select: { studentId: true, student: { select: { name: true, studentNo: true } } } },
    },
  });
  return rows.map((lesson) => ({
    id: lesson.id,
    title: lesson.title,
    startAt: lesson.startAt,
    endAt: lesson.endAt,
    teacherId: lesson.teacherId,
    classGroupId: lesson.classGroupId,
    location: lesson.location,
    classroomId: lesson.classroomId,
    students: lesson.students.map((row) => ({ id: row.studentId, name: row.student.name, studentNo: row.student.studentNo })),
  }));
}

export async function submitLessonRequest(input: {
  organizationId: string;
  userId: string;
  teacherId: string;
  lessonId: string;
  kind: "RESCHEDULE" | "SUBSTITUTE";
  startAt?: Date | null;
  endAt?: Date | null;
  substituteTeacherId?: string | null;
  note: string;
}) {
  const note = input.note.trim();
  if (note.length > 80) return { ok: false as const, message: "说明不能超过 80 个字。" };
  const lesson = await prisma.lessonSession.findFirst({
    where: { id: input.lessonId, organizationId: input.organizationId, teacherId: input.teacherId, status: { not: "CANCELLED" } },
    select: { id: true, title: true, startAt: true, teacherId: true },
  });
  if (!lesson) return { ok: false as const, message: "只能为自己还没取消的课次提出申请。" };
  if (lesson.startAt.getTime() <= Date.now()) return { ok: false as const, message: "这节课已经开始，不能再申请调课或代课。" };
  const pending = await prisma.lessonChangeRequest.findFirst({ where: { lessonSessionId: lesson.id, status: "PENDING" }, select: { id: true } });
  if (pending) return { ok: false as const, message: "这节课已经有一条待负责人同意的申请。" };
  if (input.kind === "RESCHEDULE") {
    if (!input.startAt || !input.endAt || input.endAt <= input.startAt) return { ok: false as const, message: "请填写有效的开始和结束时间。" };
    if (input.startAt.getTime() <= Date.now()) return { ok: false as const, message: "新的上课时间必须晚于现在。" };
    const full = await prisma.lessonSession.findFirst({
      where: { id: lesson.id },
      select: { teacherId: true, classGroupId: true, location: true, classroomId: true, students: { select: { studentId: true } } },
    });
    const studentIds = full?.students.map((row) => row.studentId) ?? [];
    const conflicts = full ? findScheduleConflicts({
      teacherId: full.teacherId,
      classGroupId: full.classGroupId,
      location: full.location,
      classroomId: full.classroomId,
      studentIds,
      startAt: input.startAt,
      endAt: input.endAt,
    }, await windowLessons(input.organizationId, input.startAt, input.endAt, studentIds, lesson.id)) : [];
    if (conflicts.length > 0) return { ok: false as const, message: singleConflictWarning(conflicts, formatDateTime, "这次没有提交申请。") };
  } else {
    const teacher = await prisma.teacher.findFirst({
      where: { id: input.substituteTeacherId ?? "", organizationId: input.organizationId, status: "ACTIVE" },
      select: { id: true, name: true },
    });
    if (!teacher || teacher.id === lesson.teacherId) return { ok: false as const, message: "请选择另一位在职教师来代这节课。" };
  }
  await prisma.lessonChangeRequest.create({
    data: {
      organizationId: input.organizationId,
      lessonSessionId: lesson.id,
      kind: input.kind,
      startAt: input.kind === "RESCHEDULE" ? input.startAt : null,
      endAt: input.kind === "RESCHEDULE" ? input.endAt : null,
      substituteTeacherId: input.kind === "SUBSTITUTE" ? input.substituteTeacherId : null,
      note,
      requestedById: input.userId,
    },
  });
  return { ok: true as const, message: input.kind === "RESCHEDULE" ? "调课申请已提交，负责人同意后才会改时间。" : "代课申请已提交，负责人同意后才会换教师。" };
}

export async function cancelLessonRequest(input: { organizationId: string; userId: string; requestId: string }) {
  const row = await prisma.lessonChangeRequest.findFirst({
    where: { id: input.requestId, organizationId: input.organizationId, requestedById: input.userId, status: "PENDING" },
    select: { id: true },
  });
  if (!row) return { ok: false as const, message: "这条申请已经处理过，不能撤回。" };
  await prisma.lessonChangeRequest.update({ where: { id: row.id }, data: { status: "CANCELLED", reviewedAt: new Date(), reviewNote: "教师撤回" } });
  return { ok: true as const, message: "申请已撤回，课次没有变化。" };
}

async function closeRequest(id: string, userId: string, status: "REJECTED" | "CANCELLED", reviewNote: string) {
  await prisma.lessonChangeRequest.update({ where: { id }, data: { status, reviewedById: userId, reviewedAt: new Date(), reviewNote } });
}

export async function reviewLessonRequest(input: { organizationId: string; userId: string; requestId: string; decision: "APPROVED" | "REJECTED" }) {
  const row = await prisma.lessonChangeRequest.findFirst({
    where: { id: input.requestId, organizationId: input.organizationId, status: "PENDING" },
    select: {
      id: true, kind: true, startAt: true, endAt: true, note: true, substituteTeacherId: true,
      substituteTeacher: { select: { id: true, name: true, status: true } },
      lessonSession: {
        select: {
          id: true, title: true, status: true, startAt: true, endAt: true, teacherId: true, classGroupId: true, location: true, classroomId: true,
          students: { select: { studentId: true } },
        },
      },
    },
  });
  if (!row) return { ok: false as const, message: "这条申请已经不在待同意里。" };
  const lesson = row.lessonSession;
  if (input.decision === "REJECTED") {
    await closeRequest(row.id, input.userId, "REJECTED", "负责人未同意");
    return { ok: true as const, message: "已拒绝，课次保持原样。" };
  }
  if (lesson.status === "CANCELLED" || lesson.startAt.getTime() <= Date.now()) {
    await closeRequest(row.id, input.userId, "REJECTED", "课次已开始或已取消");
    return { ok: false as const, message: "这节课已经开始或已取消，申请没有生效。" };
  }
  if (row.kind === "RESCHEDULE") {
    if (!row.startAt || !row.endAt || row.endAt <= row.startAt) return { ok: false as const, message: "申请里的时间不完整。" };
    const studentIds = lesson.students.map((item) => item.studentId);
    const conflicts = findScheduleConflicts({
      teacherId: lesson.teacherId,
      classGroupId: lesson.classGroupId,
      location: lesson.location,
      classroomId: lesson.classroomId,
      studentIds,
      startAt: row.startAt,
      endAt: row.endAt,
    }, await windowLessons(input.organizationId, row.startAt, row.endAt, studentIds, lesson.id));
    if (conflicts.length > 0) return { ok: false as const, message: singleConflictWarning(conflicts, formatDateTime, "申请仍待处理，课次没有改。") };
    await prisma.$transaction(async (tx) => {
      const updated = await tx.lessonSession.updateMany({
        where: { id: lesson.id, organizationId: input.organizationId, status: { not: "CANCELLED" }, startAt: lesson.startAt },
        data: { startAt: row.startAt!, endAt: row.endAt! },
      });
      if (updated.count !== 1) throw new Error("changed");
      await tx.lessonChangeRequest.update({ where: { id: row.id }, data: { status: "APPROVED", reviewedById: input.userId, reviewedAt: new Date() } });
      await writeAudit(tx, {
        organizationId: input.organizationId,
        actorId: input.userId,
        action: "LESSON_RESCHEDULED",
        targetType: "LessonSession",
        targetId: lesson.id,
        detail: `同意把「${lesson.title ?? "课次"}」从 ${formatDateTime(lesson.startAt)} 改到 ${formatDateTime(row.startAt!)}–${formatClock(row.endAt!)}`,
      });
    }).catch(() => null);
    const saved = await prisma.lessonChangeRequest.findUnique({ where: { id: row.id }, select: { status: true } });
    if (saved?.status !== "APPROVED") return { ok: false as const, message: "课次刚刚有变化，没有改时间。请再看一次申请。" };
    await notifyLessonChange({
      organizationId: input.organizationId,
      studentIds: lesson.students.map((item) => item.studentId),
      title: lesson.title,
      when: row.startAt!,
      change: `上课时间改为 ${formatDateTime(row.startAt!)}–${formatClock(row.endAt!)}`,
      dedupeKey: `lesson:${lesson.id}:time:${row.startAt!.toISOString()}:${row.endAt!.toISOString()}`,
    });
    return { ok: true as const, message: "已同意，上课时间已改。" };
  }
  const teacher = row.substituteTeacher;
  if (!teacher || teacher.status !== "ACTIVE" || teacher.id === lesson.teacherId) {
    await closeRequest(row.id, input.userId, "REJECTED", "代课教师不可用");
    return { ok: false as const, message: "代课教师已不在职，申请没有生效。" };
  }
  const conflicts = findScheduleConflicts(
    { teacherId: teacher.id, classGroupId: "", location: "", classroomId: null, studentIds: [], startAt: lesson.startAt, endAt: lesson.endAt },
    await windowLessons(input.organizationId, lesson.startAt, lesson.endAt, [], lesson.id),
    ["teacher"],
  );
  if (conflicts.length > 0) return { ok: false as const, message: `${teacher.name}在同一时间已有课，申请仍待处理。` };
  await prisma.$transaction(async (tx) => {
    const updated = await tx.lessonSession.updateMany({
      where: { id: lesson.id, organizationId: input.organizationId, status: { not: "CANCELLED" }, teacherId: lesson.teacherId },
      data: { teacherId: teacher.id },
    });
    if (updated.count !== 1) throw new Error("changed");
    await tx.lessonChangeRequest.update({ where: { id: row.id }, data: { status: "APPROVED", reviewedById: input.userId, reviewedAt: new Date() } });
    await writeAudit(tx, {
      organizationId: input.organizationId,
      actorId: input.userId,
      action: "LESSON_TEACHER_CHANGED",
      targetType: "LessonSession",
      targetId: lesson.id,
      detail: `同意由${teacher.name}代「${lesson.title ?? "课次"}」${formatDateTime(lesson.startAt)}`,
    });
  }).catch(() => null);
  const saved = await prisma.lessonChangeRequest.findUnique({ where: { id: row.id }, select: { status: true } });
  if (saved?.status !== "APPROVED") return { ok: false as const, message: "课次刚刚有变化，没有换教师。" };
  await notifyLessonChange({
    organizationId: input.organizationId,
    studentIds: lesson.students.map((item) => item.studentId),
    title: lesson.title,
    when: lesson.startAt,
    change: `改由${teacher.name}上课`,
    dedupeKey: `lesson:${lesson.id}:teacher:${teacher.id}`,
  });
  return { ok: true as const, message: `已同意，这节课改由${teacher.name}上。` };
}

export async function cancelPendingLessonRequests(organizationId: string, lessonId: string, reviewNote: string) {
  await prisma.lessonChangeRequest.updateMany({
    where: { organizationId, lessonSessionId: lessonId, status: "PENDING" },
    data: { status: "CANCELLED", reviewedAt: new Date(), reviewNote },
  });
}
