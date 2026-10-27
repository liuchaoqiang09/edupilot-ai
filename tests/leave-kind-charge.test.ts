/**
 * 事假/病假扣费与一键转请假闭环（对真实库写临时数据，测完删除）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "crypto";
import { PrismaClient } from "@prisma/client";
import { syncAttendanceCharge } from "@/lib/course-hours";
import { convertAbsentToLeaveInTx } from "@/lib/leave-kind";

const prisma = new PrismaClient();

async function setupFixture() {
  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) throw new Error("库里没有机构，无法跑集成测试。");
  const actor = await prisma.user.findFirst({
    where: { organizationId: org.id, roles: { has: "OWNER" } },
    select: { id: true },
  });
  if (!actor) throw new Error("库里没有负责人账号。");

  const suffix = randomUUID().slice(0, 8);
  const teacher = await prisma.teacher.create({
    data: { organizationId: org.id, name: `测教师-${suffix}`, status: "ACTIVE" },
    select: { id: true },
  });
  const student = await prisma.student.create({
    data: { organizationId: org.id, name: `测学生-${suffix}`, studentNo: `T-${suffix}`, status: "ACTIVE" },
    select: { id: true, name: true },
  });
  const courseLesson = await prisma.course.create({
    data: { organizationId: org.id, name: `按课时课-${suffix}`, category: "ACADEMIC", billingType: "PER_LESSON" },
    select: { id: true, name: true, billingType: true },
  });
  const coursePeriod = await prisma.course.create({
    data: { organizationId: org.id, name: `按周期课-${suffix}`, category: "ACADEMIC", billingType: "PER_PERIOD" },
    select: { id: true, name: true, billingType: true },
  });
  await prisma.courseHourBalance.create({
    data: { organizationId: org.id, studentId: student.id, courseId: courseLesson.id, remainingHours: 10 },
  });
  const classGroup = await prisma.classGroup.create({
    data: {
      organizationId: org.id,
      name: `测班-${suffix}`,
      courseId: courseLesson.id,
      teacherId: teacher.id,
      capacity: 8,
    },
    select: { id: true },
  });
  const start = new Date(Date.now() + 86_400_000);
  const end = new Date(start.getTime() + 3_600_000);
  const lessonA = await prisma.lessonSession.create({
    data: {
      organizationId: org.id,
      courseId: courseLesson.id,
      classGroupId: classGroup.id,
      teacherId: teacher.id,
      title: `原课-${suffix}`,
      startAt: start,
      endAt: end,
      status: "SCHEDULED",
      createdById: actor.id,
    },
    select: { id: true },
  });
  const lessonB = await prisma.lessonSession.create({
    data: {
      organizationId: org.id,
      courseId: courseLesson.id,
      classGroupId: classGroup.id,
      teacherId: teacher.id,
      title: `补课目标-${suffix}`,
      startAt: new Date(start.getTime() + 86_400_000),
      endAt: new Date(end.getTime() + 86_400_000),
      status: "SCHEDULED",
      createdById: actor.id,
    },
    select: { id: true },
  });
  const periodClass = await prisma.classGroup.create({
    data: {
      organizationId: org.id,
      name: `周期班-${suffix}`,
      courseId: coursePeriod.id,
      teacherId: teacher.id,
      capacity: 8,
    },
    select: { id: true },
  });
  const periodLesson = await prisma.lessonSession.create({
    data: {
      organizationId: org.id,
      courseId: coursePeriod.id,
      classGroupId: periodClass.id,
      teacherId: teacher.id,
      title: `周期课-${suffix}`,
      startAt: start,
      endAt: end,
      status: "SCHEDULED",
      createdById: actor.id,
    },
    select: { id: true },
  });

  return { org, actor, teacher, student, courseLesson, coursePeriod, lessonA, lessonB, periodLesson, suffix };
}

async function remaining(orgId: string, studentId: string, courseId: string) {
  const row = await prisma.courseHourBalance.findFirst({
    where: { organizationId: orgId, studentId, courseId },
    select: { remainingHours: true },
  });
  return row?.remainingHours ?? 0;
}

async function cleanup(ids: {
  lessonIds: string[];
  studentId: string;
  courseIds: string[];
  teacherId: string;
  classGroupIds?: string[];
}) {
  await prisma.auditLog.deleteMany({ where: { targetId: { in: ids.lessonIds } } }).catch(() => undefined);
  await prisma.lessonStudent.deleteMany({ where: { lessonSessionId: { in: ids.lessonIds } } });
  await prisma.lessonSession.deleteMany({ where: { id: { in: ids.lessonIds } } });
  await prisma.courseHourBalance.deleteMany({ where: { studentId: ids.studentId, courseId: { in: ids.courseIds } } });
  await prisma.classGroup.deleteMany({ where: { courseId: { in: ids.courseIds } } });
  await prisma.course.deleteMany({ where: { id: { in: ids.courseIds } } });
  await prisma.student.deleteMany({ where: { id: ids.studentId } });
  await prisma.teacher.deleteMany({ where: { id: ids.teacherId } });
}

test("计划1–6：请假不扣、缺勤扣、转病假退回、补课扣、周期/试听不扣", async () => {
  const fx = await setupFixture();
  const lessonIds = [fx.lessonA.id, fx.lessonB.id, fx.periodLesson.id];
  try {
    const enrolled = await prisma.lessonStudent.create({
      data: {
        organizationId: fx.org.id,
        lessonSessionId: fx.lessonA.id,
        studentId: fx.student.id,
        seat: "ENROLLED",
        lastAction: "测试加入",
      },
      select: { id: true },
    });

    // 1a 事假保存 → 余额不变
    let hours = await remaining(fx.org.id, fx.student.id, fx.courseLesson.id);
    await prisma.$transaction((tx) =>
      syncAttendanceCharge(tx, {
        organizationId: fx.org.id,
        lessonStudentId: enrolled.id,
        studentId: fx.student.id,
        studentName: fx.student.name,
        courseId: fx.courseLesson.id,
        courseName: fx.courseLesson.name,
        billingType: "PER_LESSON",
        seat: "ENROLLED",
        shouldCharge: false,
        attendanceStatus: "LEAVE",
        attendanceNote: "事假",
        leaveKind: "PERSONAL",
      }),
    );
    assert.equal(await remaining(fx.org.id, fx.student.id, fx.courseLesson.id), hours);
    let row = await prisma.lessonStudent.findUniqueOrThrow({ where: { id: enrolled.id } });
    assert.equal(row.attendanceStatus, "LEAVE");
    assert.equal(row.leaveKind, "PERSONAL");
    assert.equal(row.hoursCharged, false);

    // 1b 病假 → 余额不变
    await prisma.$transaction((tx) =>
      syncAttendanceCharge(tx, {
        organizationId: fx.org.id,
        lessonStudentId: enrolled.id,
        studentId: fx.student.id,
        studentName: fx.student.name,
        courseId: fx.courseLesson.id,
        courseName: fx.courseLesson.name,
        billingType: "PER_LESSON",
        seat: "ENROLLED",
        shouldCharge: false,
        attendanceStatus: "LEAVE",
        attendanceNote: "病假",
        leaveKind: "SICK",
      }),
    );
    assert.equal(await remaining(fx.org.id, fx.student.id, fx.courseLesson.id), hours);
    row = await prisma.lessonStudent.findUniqueOrThrow({ where: { id: enrolled.id } });
    assert.equal(row.leaveKind, "SICK");

    // 1c 缺勤 → 扣 1
    hours = await remaining(fx.org.id, fx.student.id, fx.courseLesson.id);
    await prisma.$transaction((tx) =>
      syncAttendanceCharge(tx, {
        organizationId: fx.org.id,
        lessonStudentId: enrolled.id,
        studentId: fx.student.id,
        studentName: fx.student.name,
        courseId: fx.courseLesson.id,
        courseName: fx.courseLesson.name,
        billingType: "PER_LESSON",
        seat: "ENROLLED",
        shouldCharge: true,
        attendanceStatus: "ABSENT",
        attendanceNote: "缺勤",
        leaveKind: null,
      }),
    );
    assert.equal(await remaining(fx.org.id, fx.student.id, fx.courseLesson.id), hours - 1);
    row = await prisma.lessonStudent.findUniqueOrThrow({ where: { id: enrolled.id } });
    assert.equal(row.hoursCharged, true);
    assert.equal(row.attendanceStatus, "ABSENT");
    assert.equal(row.leaveKind, null);

    // 2 + 3：缺勤已扣 → 一键转病假 → 余额 +1，审计留痕
    hours = await remaining(fx.org.id, fx.student.id, fx.courseLesson.id);
    const converted = await prisma.$transaction((tx) =>
      convertAbsentToLeaveInTx(tx, {
        organizationId: fx.org.id,
        actorId: fx.actor.id,
        actorRole: "负责人",
        lessonStudentId: enrolled.id,
        leaveKind: "SICK",
      }),
    );
    assert.equal(converted.refunded, true);
    assert.equal(await remaining(fx.org.id, fx.student.id, fx.courseLesson.id), hours + 1);
    row = await prisma.lessonStudent.findUniqueOrThrow({ where: { id: enrolled.id } });
    assert.equal(row.attendanceStatus, "LEAVE");
    assert.equal(row.leaveKind, "SICK");
    assert.equal(row.hoursCharged, false);
    const audit = await prisma.auditLog.findFirst({
      where: { organizationId: fx.org.id, targetId: enrolled.id, action: "ABSENT_TO_LEAVE" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(audit?.detail.includes("病假"));
    assert.ok(audit?.detail.includes("退回1课时"));

    // 3 补课筛选：LEAVE 可安排补课
    const makeup = await prisma.lessonStudent.create({
      data: {
        organizationId: fx.org.id,
        lessonSessionId: fx.lessonB.id,
        studentId: fx.student.id,
        seat: "GUEST",
        makeupSourceId: enrolled.id,
        lastAction: "补测试请假",
      },
      select: { id: true },
    });
    assert.equal((await prisma.lessonStudent.findUniqueOrThrow({ where: { id: enrolled.id } })).attendanceStatus, "LEAVE");

    // 4 补课当天出勤 → 扣 1；原课仍不扣 → 净消耗 1
    hours = await remaining(fx.org.id, fx.student.id, fx.courseLesson.id);
    await prisma.$transaction((tx) =>
      syncAttendanceCharge(tx, {
        organizationId: fx.org.id,
        lessonStudentId: makeup.id,
        studentId: fx.student.id,
        studentName: fx.student.name,
        courseId: fx.courseLesson.id,
        courseName: fx.courseLesson.name,
        billingType: "PER_LESSON",
        seat: "GUEST",
        shouldCharge: true,
        attendanceStatus: "PRESENT",
        attendanceNote: null,
        leaveKind: null,
      }),
    );
    assert.equal(await remaining(fx.org.id, fx.student.id, fx.courseLesson.id), hours - 1);
    const source = await prisma.lessonStudent.findUniqueOrThrow({ where: { id: enrolled.id } });
    assert.equal(source.hoursCharged, false);

    // 6 周期课：状态改变不扣不报错；审计「未扣课时无需退回」路径
    const periodSeat = await prisma.lessonStudent.create({
      data: {
        organizationId: fx.org.id,
        lessonSessionId: fx.periodLesson.id,
        studentId: fx.student.id,
        seat: "ENROLLED",
        attendanceStatus: "ABSENT",
        hoursCharged: false,
        lastAction: "周期缺勤",
      },
      select: { id: true },
    });
    const periodBefore = await remaining(fx.org.id, fx.student.id, fx.courseLesson.id);
    const periodConvert = await prisma.$transaction((tx) =>
      convertAbsentToLeaveInTx(tx, {
        organizationId: fx.org.id,
        actorId: fx.actor.id,
        actorRole: "教师",
        lessonStudentId: periodSeat.id,
        leaveKind: "PERSONAL",
      }),
    );
    assert.equal(periodConvert.refunded, false);
    assert.equal(await remaining(fx.org.id, fx.student.id, fx.courseLesson.id), periodBefore);
    const periodAudit = await prisma.auditLog.findFirst({
      where: { organizationId: fx.org.id, targetId: periodSeat.id, action: "ABSENT_TO_LEAVE" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(periodAudit?.detail.includes("仅改状态，未扣课时无需退回"));

    // 试听：缺勤改病假不扣不退
    const trial = await prisma.lessonStudent.create({
      data: {
        organizationId: fx.org.id,
        lessonSessionId: fx.lessonB.id,
        studentId: fx.student.id,
        seat: "TRIAL",
        attendanceStatus: "ABSENT",
        hoursCharged: false,
        lastAction: "试听缺勤",
      },
      select: { id: true },
    }).catch(async () => {
      // lessonB 已有该学生时换 periodLesson 不适用；改用新建课次会复杂，这里跳过重复唯一约束
      return null;
    });
    // lessonB 已有学生，试听挂在 periodLesson 不行（课程不同）。新建临时课次：
    if (!trial) {
      const trialLesson = await prisma.lessonSession.create({
        data: {
          organizationId: fx.org.id,
          courseId: fx.courseLesson.id,
          classGroupId: (await prisma.classGroup.findFirst({ where: { courseId: fx.courseLesson.id }, select: { id: true } }))!.id,
          teacherId: fx.teacher.id,
          title: `试听课-${fx.suffix}`,
          startAt: new Date(Date.now() + 172_800_000),
          endAt: new Date(Date.now() + 176_400_000),
          status: "SCHEDULED",
          createdById: fx.actor.id,
        },
        select: { id: true },
      });
      lessonIds.push(trialLesson.id);
      const trialSeat = await prisma.lessonStudent.create({
        data: {
          organizationId: fx.org.id,
          lessonSessionId: trialLesson.id,
          studentId: fx.student.id,
          seat: "TRIAL",
          attendanceStatus: "ABSENT",
          hoursCharged: false,
          lastAction: "试听缺勤",
        },
        select: { id: true },
      });
      const beforeTrial = await remaining(fx.org.id, fx.student.id, fx.courseLesson.id);
      await prisma.$transaction((tx) =>
        syncAttendanceCharge(tx, {
          organizationId: fx.org.id,
          lessonStudentId: trialSeat.id,
          studentId: fx.student.id,
          studentName: fx.student.name,
          courseId: fx.courseLesson.id,
          courseName: fx.courseLesson.name,
          billingType: "PER_LESSON",
          seat: "TRIAL",
          shouldCharge: true,
          attendanceStatus: "ABSENT",
          attendanceNote: null,
          leaveKind: null,
        }),
      );
      assert.equal(await remaining(fx.org.id, fx.student.id, fx.courseLesson.id), beforeTrial);
      const trialConvert = await prisma.$transaction((tx) =>
        convertAbsentToLeaveInTx(tx, {
          organizationId: fx.org.id,
          actorId: fx.actor.id,
          actorRole: "教师",
          lessonStudentId: trialSeat.id,
          leaveKind: "SICK",
        }),
      );
      assert.equal(trialConvert.refunded, false);
      assert.equal(await remaining(fx.org.id, fx.student.id, fx.courseLesson.id), beforeTrial);
    }

    // 5 家长侧展示：迁移后 LEAVE + PERSONAL/SICK 文案由 attendanceDisplayLabel 覆盖（单元测已验）
  } finally {
    await prisma.auditLog.deleteMany({
      where: {
        organizationId: fx.org.id,
        OR: [
          { detail: { contains: fx.student.name } },
          { targetType: "LessonStudent" },
        ],
      },
    }).catch(() => undefined);
    await cleanup({
      lessonIds,
      studentId: fx.student.id,
      courseIds: [fx.courseLesson.id, fx.coursePeriod.id],
      teacherId: fx.teacher.id,
    });
    await prisma.$disconnect();
  }
});
