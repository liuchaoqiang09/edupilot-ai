import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "crypto";
import { PrismaClient } from "@prisma/client";
import { CourseHourError } from "@/lib/course-hours";
import { repairInvalidEnrolledSeats, resolveLessonSeat, resolveTeacherAddSeat } from "@/lib/lesson-seat-rules";

const prisma = new PrismaClient();

async function fixture() {
  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) throw new Error("无机构");
  const actor = await prisma.user.findFirst({ where: { organizationId: org.id }, select: { id: true } });
  if (!actor) throw new Error("无用户");
  const suffix = randomUUID().slice(0, 8);
  const teacher = await prisma.teacher.create({
    data: { organizationId: org.id, name: `座教师-${suffix}`, status: "ACTIVE" },
    select: { id: true },
  });
  const course = await prisma.course.create({
    data: { organizationId: org.id, name: `座课程-${suffix}`, category: "ACADEMIC", billingType: "PER_LESSON" },
    select: { id: true },
  });
  const classA = await prisma.classGroup.create({
    data: { organizationId: org.id, name: `A班-${suffix}`, courseId: course.id, teacherId: teacher.id, capacity: 10 },
    select: { id: true },
  });
  const classB = await prisma.classGroup.create({
    data: { organizationId: org.id, name: `B班-${suffix}`, courseId: course.id, teacherId: teacher.id, capacity: 10 },
    select: { id: true },
  });
  const enrolledA = await prisma.student.create({
    data: { organizationId: org.id, name: `报A-${suffix}`, studentNo: `SA-${suffix}`, status: "ACTIVE" },
    select: { id: true, name: true },
  });
  const none = await prisma.student.create({
    data: { organizationId: org.id, name: `未报-${suffix}`, studentNo: `SN-${suffix}`, status: "ACTIVE" },
    select: { id: true, name: true },
  });
  await prisma.enrollment.create({
    data: {
      organizationId: org.id,
      studentId: enrolledA.id,
      courseId: course.id,
      classGroupId: classA.id,
      amountDue: "100",
      amount: "100",
      hoursAdded: 10,
      status: "PAID",
      createdById: actor.id,
    },
  });
  return { org, actor, teacher, course, classA, classB, enrolledA, none, suffix };
}

async function wipe(fx: Awaited<ReturnType<typeof fixture>>, lessonIds: string[] = []) {
  if (lessonIds.length) {
    await prisma.lessonStudent.deleteMany({ where: { lessonSessionId: { in: lessonIds } } });
    await prisma.lessonSession.deleteMany({ where: { id: { in: lessonIds } } });
  }
  await prisma.enrollment.deleteMany({ where: { studentId: { in: [fx.enrolledA.id, fx.none.id] } } });
  await prisma.student.deleteMany({ where: { id: { in: [fx.enrolledA.id, fx.none.id] } } });
  await prisma.classGroup.deleteMany({ where: { id: { in: [fx.classA.id, fx.classB.id] } } });
  await prisma.course.deleteMany({ where: { id: fx.course.id } });
  await prisma.teacher.deleteMany({ where: { id: fx.teacher.id } });
}

test("本班：同班报名通过；未报名与跨班拒绝", async () => {
  const fx = await fixture();
  try {
    const ok = await resolveLessonSeat(prisma, {
      organizationId: fx.org.id,
      studentId: fx.enrolledA.id,
      studentName: fx.enrolledA.name,
      courseId: fx.course.id,
      classGroupId: fx.classA.id,
      requested: "ENROLLED",
    });
    assert.equal(ok.seat, "ENROLLED");

    await assert.rejects(
      () => resolveLessonSeat(prisma, {
        organizationId: fx.org.id,
        studentId: fx.none.id,
        studentName: fx.none.name,
        courseId: fx.course.id,
        classGroupId: fx.classA.id,
        requested: "ENROLLED",
      }),
      (error: unknown) => error instanceof CourseHourError && error.message.includes("未报名"),
    );

    await assert.rejects(
      () => resolveLessonSeat(prisma, {
        organizationId: fx.org.id,
        studentId: fx.enrolledA.id,
        studentName: fx.enrolledA.name,
        courseId: fx.course.id,
        classGroupId: fx.classB.id,
        requested: "ENROLLED",
      }),
      (error: unknown) => error instanceof CourseHourError && error.message.includes("其他班"),
    );
  } finally {
    await wipe(fx);
  }
});

test("临时：同课跨班通过；未报名拒绝；试听未报名通过", async () => {
  const fx = await fixture();
  try {
    const guest = await resolveLessonSeat(prisma, {
      organizationId: fx.org.id,
      studentId: fx.enrolledA.id,
      studentName: fx.enrolledA.name,
      courseId: fx.course.id,
      classGroupId: fx.classB.id,
      requested: "GUEST",
    });
    assert.equal(guest.seat, "GUEST");

    await assert.rejects(
      () => resolveLessonSeat(prisma, {
        organizationId: fx.org.id,
        studentId: fx.none.id,
        studentName: fx.none.name,
        courseId: fx.course.id,
        classGroupId: fx.classA.id,
        requested: "GUEST",
      }),
      (error: unknown) => error instanceof CourseHourError && error.message.includes("试听"),
    );

    const trial = await resolveLessonSeat(prisma, {
      organizationId: fx.org.id,
      studentId: fx.none.id,
      studentName: fx.none.name,
      courseId: fx.course.id,
      classGroupId: fx.classA.id,
      requested: "TRIAL",
    });
    assert.equal(trial.seat, "TRIAL");
  } finally {
    await wipe(fx);
  }
});

test("教师加入：本班强制本班；跨班临时；未报名只能试听", async () => {
  const fx = await fixture();
  try {
    const home = await resolveTeacherAddSeat(prisma, {
      organizationId: fx.org.id,
      studentId: fx.enrolledA.id,
      studentName: fx.enrolledA.name,
      courseId: fx.course.id,
      classGroupId: fx.classA.id,
      requested: "GUEST",
    });
    assert.equal(home.seat, "ENROLLED");
    assert.equal(home.forcedClass, true);

    const cross = await resolveTeacherAddSeat(prisma, {
      organizationId: fx.org.id,
      studentId: fx.enrolledA.id,
      studentName: fx.enrolledA.name,
      courseId: fx.course.id,
      classGroupId: fx.classB.id,
      requested: "GUEST",
    });
    assert.equal(cross.seat, "GUEST");

    await assert.rejects(
      () => resolveTeacherAddSeat(prisma, {
        organizationId: fx.org.id,
        studentId: fx.none.id,
        studentName: fx.none.name,
        courseId: fx.course.id,
        classGroupId: fx.classA.id,
        requested: "GUEST",
      }),
      (error: unknown) => error instanceof CourseHourError,
    );
  } finally {
    await wipe(fx);
  }
});

test("修复脏数据：无报名本班移出；跨班本班改临时", async () => {
  const fx = await fixture();
  const lessonIds: string[] = [];
  try {
    const start = new Date(Date.now() + 86_400_000);
    const end = new Date(start.getTime() + 3_600_000);
    const dirtyLesson = await prisma.lessonSession.create({
      data: {
        organizationId: fx.org.id,
        courseId: fx.course.id,
        classGroupId: fx.classB.id,
        teacherId: fx.teacher.id,
        title: `脏课-${fx.suffix}`,
        startAt: start,
        endAt: end,
        status: "SCHEDULED",
        createdById: fx.actor.id,
      },
      select: { id: true },
    });
    lessonIds.push(dirtyLesson.id);
    const noEnroll = await prisma.lessonStudent.create({
      data: {
        organizationId: fx.org.id,
        lessonSessionId: dirtyLesson.id,
        studentId: fx.none.id,
        seat: "ENROLLED",
        lastAction: "加入课次",
      },
      select: { id: true },
    });
    const cross = await prisma.lessonStudent.create({
      data: {
        organizationId: fx.org.id,
        lessonSessionId: dirtyLesson.id,
        studentId: fx.enrolledA.id,
        seat: "ENROLLED",
        lastAction: "加入课次",
      },
      select: { id: true },
    });

    const result = await repairInvalidEnrolledSeats(prisma, fx.org.id);
    assert.ok(result.removed >= 1);
    assert.ok(result.converted >= 1);
    assert.equal(await prisma.lessonStudent.findUnique({ where: { id: noEnroll.id } }), null);
    const fixed = await prisma.lessonStudent.findUniqueOrThrow({ where: { id: cross.id } });
    assert.equal(fixed.seat, "GUEST");
  } finally {
    await wipe(fx, lessonIds);
    await prisma.$disconnect();
  }
});
