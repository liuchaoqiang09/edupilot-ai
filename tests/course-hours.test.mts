import assert from "node:assert/strict";
import { loadEnvFile } from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));

const { prisma } = await import("../lib/prisma.ts");
const { creditCourseHours, releaseChargedHour, syncAttendanceCharge } = await import("../lib/course-hours.ts");

const suffix = `${Date.now()}`;

async function seed() {
  const organization = await prisma.organization.create({ data: { name: `课时测试 ${suffix}` } });
  const user = await prisma.user.create({
    data: {
      organizationId: organization.id,
      email: `hours-${suffix}@edupilot.test`,
      passwordHash: "test-only",
      name: "课时测试",
      roles: ["OWNER"],
    },
  });
  const teacher = await prisma.teacher.create({ data: { organizationId: organization.id, name: "测试教师" } });
  const student = await prisma.student.create({ data: { organizationId: organization.id, name: "测试学员" } });
  const math = await prisma.course.create({ data: { organizationId: organization.id, name: "测试数学" } });
  const art = await prisma.course.create({ data: { organizationId: organization.id, name: "测试美术" } });
  const mathClass = await prisma.classGroup.create({
    data: { organizationId: organization.id, name: "数学组", courseId: math.id, teacherId: teacher.id },
  });
  const artClass = await prisma.classGroup.create({
    data: { organizationId: organization.id, name: "美术组", courseId: art.id, teacherId: teacher.id },
  });
  const start = new Date("2026-10-22T08:00:00+08:00");
  const end = new Date("2026-10-22T09:00:00+08:00");
  const mathLesson = await prisma.lessonSession.create({
    data: {
      organizationId: organization.id,
      classGroupId: mathClass.id,
      courseId: math.id,
      teacherId: teacher.id,
      startAt: start,
      endAt: end,
      createdById: user.id,
      students: { create: { organizationId: organization.id, studentId: student.id } },
    },
    include: { students: true },
  });
  const artLesson = await prisma.lessonSession.create({
    data: {
      organizationId: organization.id,
      classGroupId: artClass.id,
      courseId: art.id,
      teacherId: teacher.id,
      startAt: start,
      endAt: end,
      createdById: user.id,
      students: { create: { organizationId: organization.id, studentId: student.id } },
    },
    include: { students: true },
  });
  return { organization, user, teacher, student, math, art, mathClass, artClass, mathLesson, artLesson };
}

async function cleanup(organizationId: string) {
  await prisma.lessonStudent.deleteMany({ where: { organizationId } });
  await prisma.lessonSession.deleteMany({ where: { organizationId } });
  await prisma.classGroup.deleteMany({ where: { organizationId } });
  await prisma.courseHourBalance.deleteMany({ where: { organizationId } });
  await prisma.enrollment.deleteMany({ where: { organizationId } });
  await prisma.student.deleteMany({ where: { organizationId } });
  await prisma.teacher.deleteMany({ where: { organizationId } });
  await prisma.course.deleteMany({ where: { organizationId } });
  await prisma.user.deleteMany({ where: { organizationId } });
  await prisma.organization.deleteMany({ where: { id: organizationId } });
}

async function balance(studentId: string, courseId: string) {
  const row = await prisma.courseHourBalance.findUnique({
    where: { studentId_courseId: { studentId, courseId } },
    select: { remainingHours: true },
  });
  return row?.remainingHours ?? null;
}

test("course hours stay separate and survive repeat, refund, shortage, concurrency, and roster removal", async () => {
  const data = await seed();
  try {
    await prisma.$transaction(async (tx) => {
      await creditCourseHours(tx, { organizationId: data.organization.id, studentId: data.student.id, courseId: data.math.id, hours: 2 });
      await creditCourseHours(tx, { organizationId: data.organization.id, studentId: data.student.id, courseId: data.art.id, hours: 5 });
    });
    assert.equal(await balance(data.student.id, data.math.id), 2);
    assert.equal(await balance(data.student.id, data.art.id), 5);

    const mathRoster = data.mathLesson.students[0];
    const artRoster = data.artLesson.students[0];
    const chargeMath = {
      organizationId: data.organization.id,
      lessonStudentId: mathRoster.id,
      studentId: data.student.id,
      studentName: data.student.name,
      courseId: data.math.id,
      courseName: data.math.name,
      shouldCharge: true,
      attendanceStatus: "PRESENT" as const,
      attendanceNote: null,
    };

    await prisma.$transaction((tx) => syncAttendanceCharge(tx, chargeMath));
    assert.equal(await balance(data.student.id, data.math.id), 1);
    assert.equal(await balance(data.student.id, data.art.id), 5);

    await prisma.$transaction((tx) => syncAttendanceCharge(tx, chargeMath));
    assert.equal(await balance(data.student.id, data.math.id), 1);
    const charged = await prisma.lessonStudent.findUnique({ where: { id: mathRoster.id }, select: { hoursCharged: true, attendanceStatus: true } });
    assert.equal(charged?.hoursCharged, true);
    assert.equal(charged?.attendanceStatus, "PRESENT");

    await prisma.$transaction((tx) => syncAttendanceCharge(tx, { ...chargeMath, shouldCharge: false, attendanceStatus: "LEAVE" }));
    assert.equal(await balance(data.student.id, data.math.id), 2);
    assert.equal(await balance(data.student.id, data.art.id), 5);
    const refunded = await prisma.lessonStudent.findUnique({ where: { id: mathRoster.id }, select: { hoursCharged: true, attendanceStatus: true } });
    assert.equal(refunded?.hoursCharged, false);
    assert.equal(refunded?.attendanceStatus, "LEAVE");

    await prisma.$transaction((tx) => syncAttendanceCharge(tx, { ...chargeMath, shouldCharge: false, attendanceStatus: "ABSENT" }));
    assert.equal(await balance(data.student.id, data.math.id), 2);

    await prisma.$transaction(async (tx) => {
      await tx.courseHourBalance.update({
        where: { studentId_courseId: { studentId: data.student.id, courseId: data.math.id } },
        data: { remainingHours: 0 },
      });
    });
    await assert.rejects(
      () => prisma.$transaction((tx) => syncAttendanceCharge(tx, chargeMath)),
      /可用课时不足/,
    );
    const blocked = await prisma.lessonStudent.findUnique({ where: { id: mathRoster.id }, select: { hoursCharged: true, attendanceStatus: true } });
    assert.equal(blocked?.hoursCharged, false);
    assert.equal(blocked?.attendanceStatus, "ABSENT");
    assert.equal(await balance(data.student.id, data.math.id), 0);
    assert.equal(await balance(data.student.id, data.art.id), 5);

    await prisma.$transaction(async (tx) => {
      await tx.courseHourBalance.update({
        where: { studentId_courseId: { studentId: data.student.id, courseId: data.math.id } },
        data: { remainingHours: 1 },
      });
    });
    const results = await Promise.allSettled([
      prisma.$transaction((tx) => syncAttendanceCharge(tx, chargeMath)),
      prisma.$transaction((tx) => syncAttendanceCharge(tx, chargeMath)),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 2);
    assert.equal(await balance(data.student.id, data.math.id), 0);
    const once = await prisma.lessonStudent.findUnique({ where: { id: mathRoster.id }, select: { hoursCharged: true } });
    assert.equal(once?.hoursCharged, true);

    await prisma.$transaction((tx) => releaseChargedHour(tx, {
      organizationId: data.organization.id,
      lessonStudentId: mathRoster.id,
      studentId: data.student.id,
      courseId: data.math.id,
    }));
    assert.equal(await balance(data.student.id, data.math.id), 1);
    await prisma.$transaction(async (tx) => {
      const again = await releaseChargedHour(tx, {
        organizationId: data.organization.id,
        lessonStudentId: mathRoster.id,
        studentId: data.student.id,
        courseId: data.math.id,
      });
      assert.equal(again, false);
      await tx.lessonStudent.deleteMany({ where: { id: mathRoster.id, organizationId: data.organization.id } });
    });
    assert.equal(await balance(data.student.id, data.math.id), 1);
    assert.equal(await prisma.lessonStudent.count({ where: { id: mathRoster.id } }), 0);

    await prisma.$transaction((tx) => syncAttendanceCharge(tx, {
      organizationId: data.organization.id,
      lessonStudentId: artRoster.id,
      studentId: data.student.id,
      studentName: data.student.name,
      courseId: data.art.id,
      courseName: data.art.name,
      shouldCharge: true,
      attendanceStatus: "LATE",
      attendanceNote: null,
    }));
    assert.equal(await balance(data.student.id, data.art.id), 4);
    assert.equal(await balance(data.student.id, data.math.id), 1);

    await prisma.$transaction((tx) => syncAttendanceCharge(tx, {
      organizationId: data.organization.id,
      lessonStudentId: artRoster.id,
      studentId: data.student.id,
      studentName: data.student.name,
      courseId: data.art.id,
      courseName: data.art.name,
      billingType: "PER_PERIOD",
      shouldCharge: true,
      attendanceStatus: "PRESENT",
      attendanceNote: null,
    }));
    assert.equal(await balance(data.student.id, data.art.id), 5);
    const periodRoster = await prisma.lessonStudent.findUnique({ where: { id: artRoster.id }, select: { hoursCharged: true } });
    assert.equal(periodRoster?.hoursCharged, false);
  } finally {
    await cleanup(data.organization.id);
    await prisma.$disconnect();
  }
});
