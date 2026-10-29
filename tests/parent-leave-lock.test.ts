import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { applyParentLeave, applyCancelParentLeave } from "@/lib/parent-leave";

const prisma = new PrismaClient();

test("家长请假锁内复核：已开始课次拒绝；未来课次可请假；有补课后不可取消", async () => {
  const link = await prisma.parentStudentLink.findFirst({
    where: { student: { status: "ACTIVE" } },
    select: {
      studentId: true,
      organizationId: true,
      parent: { select: { id: true, name: true, organizationId: true } },
    },
  });
  assert.ok(link, "需要演示家长绑定");
  const course = await prisma.course.findFirst({ where: { organizationId: link.organizationId }, select: { id: true } });
  const classGroup = await prisma.classGroup.findFirst({
    where: { organizationId: link.organizationId, courseId: course!.id },
    select: { id: true, teacherId: true },
  });
  const owner = await prisma.user.findFirst({
    where: { organizationId: link.organizationId, roles: { has: "OWNER" } },
    select: { id: true },
  });
  assert.ok(course && classGroup && owner);

  const actor = { id: link.parent.id, name: link.parent.name, organizationId: link.parent.organizationId };
  const past = new Date(Date.now() - 60_000);
  const future = new Date(Date.now() + 3 * 3600_000);

  const pastLesson = await prisma.lessonSession.create({
    data: {
      organizationId: link.organizationId,
      courseId: course.id,
      classGroupId: classGroup.id,
      teacherId: classGroup.teacherId,
      title: "LOCK-PAST",
      startAt: past,
      endAt: new Date(past.getTime() + 3600_000),
      status: "SCHEDULED",
      createdById: owner.id,
    },
  });
  const pastSeat = await prisma.lessonStudent.create({
    data: {
      organizationId: link.organizationId,
      lessonSessionId: pastLesson.id,
      studentId: link.studentId,
      seat: "ENROLLED",
      attendanceStatus: "NOT_MARKED",
      lastAction: "test",
    },
  });
  const pastLeave = await applyParentLeave(actor, { lessonStudentId: pastSeat.id, note: "too late" });
  assert.equal(pastLeave.ok, false);
  assert.match(pastLeave.message, /已经开始/);

  const futureLesson = await prisma.lessonSession.create({
    data: {
      organizationId: link.organizationId,
      courseId: course.id,
      classGroupId: classGroup.id,
      teacherId: classGroup.teacherId,
      title: "LOCK-FUTURE",
      startAt: future,
      endAt: new Date(future.getTime() + 3600_000),
      status: "SCHEDULED",
      createdById: owner.id,
    },
  });
  const futureSeat = await prisma.lessonStudent.create({
    data: {
      organizationId: link.organizationId,
      lessonSessionId: futureLesson.id,
      studentId: link.studentId,
      seat: "ENROLLED",
      attendanceStatus: "NOT_MARKED",
      lastAction: "test",
    },
  });
  const okLeave = await applyParentLeave(actor, { lessonStudentId: futureSeat.id, note: "ok" });
  assert.equal(okLeave.ok, true);

  const makeupLesson = await prisma.lessonSession.create({
    data: {
      organizationId: link.organizationId,
      courseId: course.id,
      classGroupId: classGroup.id,
      teacherId: classGroup.teacherId,
      title: "LOCK-MAKEUP",
      startAt: new Date(future.getTime() + 86400_000),
      endAt: new Date(future.getTime() + 86400_000 + 3600_000),
      status: "SCHEDULED",
      createdById: owner.id,
    },
  });
  const makeupSeat = await prisma.lessonStudent.create({
    data: {
      organizationId: link.organizationId,
      lessonSessionId: makeupLesson.id,
      studentId: link.studentId,
      seat: "GUEST",
      makeupSourceId: futureSeat.id,
      attendanceStatus: "NOT_MARKED",
      lastAction: "test",
    },
  });
  const cancel = await applyCancelParentLeave(actor, { lessonStudentId: futureSeat.id });
  assert.equal(cancel.ok, false);
  assert.match(cancel.message, /补课|考勤/);

  await prisma.lessonStudent.deleteMany({ where: { id: { in: [pastSeat.id, futureSeat.id, makeupSeat.id] } } });
  await prisma.lessonSession.deleteMany({ where: { id: { in: [pastLesson.id, futureLesson.id, makeupLesson.id] } } });
});
