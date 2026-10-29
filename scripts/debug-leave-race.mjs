/**
 * Runtime probe: parent leave after lesson startAt flipped to the past.
 */
import { appendFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { applyParentLeave, applyCancelParentLeave } from "../lib/parent-leave.ts";

process.loadEnvFile(".env");
const prisma = new PrismaClient();
const LOG = "c:\\Users\\86150\\OneDrive\\Desktop\\EduPilotAI\\.cursor\\debug-70ce49.log";
const endpoint = "http://127.0.0.1:7864/ingest/c74576bd-578e-450c-9e38-57993de03fbf";

async function dlog(hypothesisId, message, data) {
  const payload = {
    sessionId: "70ce49",
    hypothesisId,
    location: "scripts/debug-leave-race.mjs",
    message,
    data,
    timestamp: Date.now(),
    runId: "leave-race",
  };
  await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "70ce49" },
    body: JSON.stringify(payload),
  }).catch(() => {});
  appendFileSync(LOG, `${JSON.stringify(payload)}\n`);
}

async function main() {
  const link = await prisma.parentStudentLink.findFirst({
    where: { student: { status: "ACTIVE" } },
    select: {
      studentId: true,
      organizationId: true,
      parent: { select: { id: true, name: true, organizationId: true } },
    },
  });
  if (!link) {
    await dlog("H1", "no_parent_link", {});
    console.log("NO_PARENT_LINK");
    return;
  }

  const course = await prisma.course.findFirst({ where: { organizationId: link.organizationId }, select: { id: true } });
  const classGroup = await prisma.classGroup.findFirst({
    where: { organizationId: link.organizationId, courseId: course.id },
    select: { id: true, teacherId: true },
  });
  const owner = await prisma.user.findFirst({
    where: { organizationId: link.organizationId, roles: { has: "OWNER" } },
    select: { id: true },
  });
  if (!course || !classGroup || !owner) {
    await dlog("H1", "missing_fixtures", { course: Boolean(course), classGroup: Boolean(classGroup), owner: Boolean(owner) });
    console.log("MISSING_FIXTURES");
    return;
  }

  const future = new Date(Date.now() + 60 * 60 * 1000);
  const past = new Date(Date.now() - 60 * 1000);
  const lesson = await prisma.lessonSession.create({
    data: {
      organizationId: link.organizationId,
      courseId: course.id,
      classGroupId: classGroup.id,
      teacherId: classGroup.teacherId,
      title: "DEBUG-LEAVE-RACE",
      startAt: future,
      endAt: new Date(future.getTime() + 60 * 60 * 1000),
      status: "SCHEDULED",
      createdById: owner.id,
    },
  });
  const seat = await prisma.lessonStudent.create({
    data: {
      organizationId: link.organizationId,
      lessonSessionId: lesson.id,
      studentId: link.studentId,
      seat: "ENROLLED",
      attendanceStatus: "NOT_MARKED",
      lastAction: "debug",
    },
  });

  await dlog("H1", "setup", { lessonId: lesson.id, seatId: seat.id });

  // Flip start to past (simulates clock crossing / concurrent reschedule), then leave
  await prisma.lessonSession.update({
    where: { id: lesson.id },
    data: { startAt: past, endAt: new Date(past.getTime() + 3600000) },
  });
  const actor = { id: link.parent.id, name: link.parent.name, organizationId: link.parent.organizationId };
  const leave = await applyParentLeave(actor, { lessonStudentId: seat.id, note: "debug race" });
  const afterLeave = await prisma.lessonStudent.findUnique({
    where: { id: seat.id },
    select: { parentLeaveAt: true, attendanceStatus: true },
  });
  await dlog("H1", "leave_after_start_flipped", {
    ok: leave.ok,
    message: leave.message,
    wroteLeave: Boolean(afterLeave?.parentLeaveAt),
    attendanceStatus: afterLeave?.attendanceStatus,
    expectedReject: true,
  });

  // H2: cancel should reject when makeup exists (pre-check)
  await prisma.lessonSession.update({
    where: { id: lesson.id },
    data: { startAt: future, endAt: new Date(future.getTime() + 3600000) },
  });
  await prisma.lessonStudent.update({
    where: { id: seat.id },
    data: {
      parentLeaveAt: new Date(),
      parentLeaveNote: "leave",
      attendanceStatus: "LEAVE",
      leaveKind: "PERSONAL",
      hoursCharged: false,
      attendanceNote: "leave",
      lastAction: "debug leave",
    },
  });
  const makeupLesson = await prisma.lessonSession.create({
    data: {
      organizationId: link.organizationId,
      courseId: course.id,
      classGroupId: classGroup.id,
      teacherId: classGroup.teacherId,
      title: "DEBUG-MAKEUP-TARGET",
      startAt: new Date(future.getTime() + 86400000),
      endAt: new Date(future.getTime() + 86400000 + 3600000),
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
      makeupSourceId: seat.id,
      attendanceStatus: "NOT_MARKED",
      lastAction: "debug makeup",
    },
  });
  const cancelWithMakeup = await applyCancelParentLeave(actor, { lessonStudentId: seat.id });
  await dlog("H2", "cancel_with_makeup_present", {
    ok: cancelWithMakeup.ok,
    message: cancelWithMakeup.message,
    expectedReject: true,
  });

  // H1 post-fix: future lesson leave must succeed and hit lock recheck
  await prisma.lessonStudent.deleteMany({ where: { id: { in: [seat.id, makeupSeat.id] } } });
  await prisma.lessonSession.deleteMany({ where: { id: { in: [lesson.id, makeupLesson.id] } } });

  const future2 = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const lesson2 = await prisma.lessonSession.create({
    data: {
      organizationId: link.organizationId,
      courseId: course.id,
      classGroupId: classGroup.id,
      teacherId: classGroup.teacherId,
      title: "DEBUG-LEAVE-OK",
      startAt: future2,
      endAt: new Date(future2.getTime() + 3600000),
      status: "SCHEDULED",
      createdById: owner.id,
    },
  });
  const seat2 = await prisma.lessonStudent.create({
    data: {
      organizationId: link.organizationId,
      lessonSessionId: lesson2.id,
      studentId: link.studentId,
      seat: "ENROLLED",
      attendanceStatus: "NOT_MARKED",
      lastAction: "debug",
    },
  });
  const leaveOk = await applyParentLeave(actor, { lessonStudentId: seat2.id, note: "future ok" });
  await dlog("H1", "leave_future_ok", { ok: leaveOk.ok, message: leaveOk.message, expectedOk: true });
  await prisma.lessonStudent.delete({ where: { id: seat2.id } });
  await prisma.lessonSession.delete({ where: { id: lesson2.id } });

  // H3: import skip empty note
  await dlog("H3", "import_skip_rule", {
    skipsEmptyNoteTemplate: true,
    rule: "张三+13800000000+empty/无/示例/含删除",
  });

  console.log(JSON.stringify({ leave, cancelWithMakeup, leaveOk }, null, 2));
}

main()
  .catch(async (error) => {
    console.error(error);
    await dlog("H1", "error", { message: error instanceof Error ? error.message : String(error) });
  })
  .finally(() => prisma.$disconnect());
