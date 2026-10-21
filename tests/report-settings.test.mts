import assert from "node:assert/strict";
import { register } from "node:module";
import { loadEnvFile } from "node:process";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import type { ReportStatus } from "@prisma/client";

await register(pathToFileURL(fileURLToPath(new URL("./resolve-ts.mjs", import.meta.url))).href, import.meta.url);

loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));

const { AiReportError, buildLessonAnalysisPrompt } = await import("../lib/ai-service.ts");
const { prisma } = await import("../lib/prisma.ts");
const { generateAndStoreDraft, publishReportByOwner, publishReportByTeacher, readOrgReportSettings, recentSummariesForPrompt, reportsVisibleToParent, returnReportByOwner } = await import("../lib/report-flow.ts");

const suffix = `${Date.now()}`;
const filled = { strengths: "优点", issues: "问题", nextSteps: "建议", homeworkSummary: "作业建议" };

test("report prompt follows the organization language and history switch", () => {
  const history = [{ label: "2026-10-18 测试数学", summary: "HIST-SENTINEL 林子涵上次学会了因式分解" }];
  const input = {
    history,
    lessonContent: "今天讲了林子涵的因式分解",
    studentPerformance: "林子涵能独立完成",
    difficulties: "没有",
    homework: "两道题",
    studentNames: ["林子涵"],
  };

  const chinese = buildLessonAnalysisPrompt({ ...input, language: "zh-CN", useRecentSummaries: true });
  assert.match(chinese.system, /简体中文/);
  assert.doesNotMatch(chinese.system, /Write clear, specific English/);
  assert.match(chinese.user, /HIST-SENTINEL/);
  assert.match(chinese.user, /该同学/);
  assert.doesNotMatch(chinese.user, /林子涵/);

  const english = buildLessonAnalysisPrompt({ ...input, language: "en", useRecentSummaries: true });
  assert.match(english.system, /Write clear, specific English/);
  assert.doesNotMatch(english.system, /简体中文/);
  assert.match(english.user, /the student/);
  assert.match(english.user, /HIST-SENTINEL/);
  assert.doesNotMatch(english.user, /林子涵/);

  const hidden = buildLessonAnalysisPrompt({ ...input, language: "zh-CN", useRecentSummaries: false });
  assert.doesNotMatch(hidden.user, /HIST-SENTINEL/);
  assert.equal(readOrgReportSettings(null).reportLanguage, "zh-CN");
  assert.equal(readOrgReportSettings(null).aiUseRecentSummaries, true);
  assert.equal(readOrgReportSettings(null).aiTeacherMustConfirm, true);
  assert.equal(readOrgReportSettings({ reportLanguage: "fr", aiUseRecentSummaries: false, aiTeacherMustConfirm: false }).reportLanguage, "zh-CN");
});

test("history, confirmation, and failed generation stay inside the organization", async () => {
  const created: string[] = [];
  try {
    const primary = await seedOrg("a");
    created.push(primary.organization.id);
    const other = await seedOrg("b");
    created.push(other.organization.id);

    const current = await addLesson(primary, {
      studentId: primary.student.id,
      courseId: primary.math.id,
      classGroupId: primary.mathClass.id,
      start: "2026-10-21T10:00:00+08:00",
      status: "RETURNED",
      summary: "当前课次",
      privateNote: "SECRET-NOTE",
    });
    const newest = await addLesson(primary, {
      studentId: primary.student.id,
      courseId: primary.math.id,
      classGroupId: primary.mathClass.id,
      start: "2026-10-20T10:00:00+08:00",
      status: "PUBLISHED",
      summary: "HIST-NEWEST",
    });
    await addLesson(primary, {
      studentId: primary.student.id,
      courseId: primary.math.id,
      classGroupId: primary.mathClass.id,
      start: "2026-10-19T10:00:00+08:00",
      status: "CONFIRMED",
      summary: "HIST-MIDDLE",
    });
    await addLesson(primary, {
      studentId: primary.student.id,
      courseId: primary.math.id,
      classGroupId: primary.mathClass.id,
      start: "2026-10-18T10:00:00+08:00",
      status: "PUBLISHED",
      summary: "HIST-THIRD",
    });
    await addLesson(primary, {
      studentId: primary.student.id,
      courseId: primary.math.id,
      classGroupId: primary.mathClass.id,
      start: "2026-10-17T10:00:00+08:00",
      status: "PUBLISHED",
      summary: "HIST-OLDEST",
    });
    await addLesson(primary, {
      studentId: primary.student.id,
      courseId: primary.math.id,
      classGroupId: primary.mathClass.id,
      start: "2026-10-16T10:00:00+08:00",
      status: "DRAFT",
      summary: "HIST-DRAFT",
    });
    await addLesson(primary, {
      studentId: primary.student.id,
      courseId: primary.art.id,
      classGroupId: primary.artClass.id,
      start: "2026-10-20T12:00:00+08:00",
      status: "PUBLISHED",
      summary: "HIST-OTHER-COURSE",
    });
    await addLesson(primary, {
      studentId: primary.otherStudent.id,
      courseId: primary.math.id,
      classGroupId: primary.mathClass.id,
      start: "2026-10-20T14:00:00+08:00",
      status: "PUBLISHED",
      summary: "HIST-OTHER-STUDENT",
    });
    await addLesson(other, {
      studentId: other.student.id,
      courseId: other.math.id,
      classGroupId: other.mathClass.id,
      start: "2026-10-20T16:00:00+08:00",
      status: "PUBLISHED",
      summary: "HIST-OTHER-ORG",
    });

    const scope = {
      enabled: true,
      organizationId: primary.organization.id,
      studentId: primary.student.id,
      courseId: primary.math.id,
      excludeLessonId: current.lesson.id,
    };
    const history = await recentSummariesForPrompt(prisma, scope);
    assert.deepEqual(history.map((item) => item.summary), ["HIST-NEWEST", "HIST-MIDDLE", "HIST-THIRD"]);
    assert.equal(JSON.stringify(history).includes("SECRET-NOTE"), false);
    assert.equal(JSON.stringify(history).includes("HIST-OLDEST"), false);
    assert.equal(JSON.stringify(history).includes("HIST-DRAFT"), false);
    assert.equal(JSON.stringify(history).includes("HIST-OTHER-COURSE"), false);
    assert.equal(JSON.stringify(history).includes("HIST-OTHER-STUDENT"), false);
    assert.equal(JSON.stringify(history).includes("HIST-OTHER-ORG"), false);
    const closed = await recentSummariesForPrompt(prisma, { ...scope, enabled: false });
    assert.deepEqual(closed, []);
    const crossed = await recentSummariesForPrompt(prisma, { ...scope, organizationId: other.organization.id });
    assert.deepEqual(crossed, []);
    const otherHistory = await recentSummariesForPrompt(prisma, {
      enabled: true,
      organizationId: other.organization.id,
      studentId: other.student.id,
      courseId: other.math.id,
      excludeLessonId: current.lesson.id,
    });
    assert.deepEqual(otherHistory.map((item) => item.summary), ["HIST-OTHER-ORG"]);

    await assert.rejects(
      () =>
        generateAndStoreDraft(prisma, draftScope(primary, current), async () => {
          throw new AiReportError("模型暂时不可用");
        }),
      /模型暂时不可用/,
    );
    const failed = await prisma.teachingReport.findUniqueOrThrow({ where: { id: current.report.id } });
    assert.equal(failed.status, "RETURNED");
    assert.equal(failed.publishedAt, null);
    assert.equal(failed.summary, "当前课次");

    await generateAndStoreDraft(prisma, draftScope(primary, current), async () => ({
      summary: "新草稿",
      strengths: "优点",
      issues: "问题",
      nextSteps: "建议",
      homeworkSummary: "作业建议",
      aiModel: "test-model",
      promptVersion: "test",
    }));
    const drafted = await prisma.teachingReport.findUniqueOrThrow({ where: { id: current.report.id } });
    assert.equal(drafted.status, "DRAFT");
    assert.equal(drafted.publishedAt, null);
    assert.equal(drafted.summary, "新草稿");

    await prisma.teachingReport.update({ where: { id: newest.report.id }, data: { status: "PUBLISHED" } });
    await assert.rejects(
      () =>
        generateAndStoreDraft(prisma, draftScope(primary, newest), async () => ({
          summary: "不应覆盖",
          strengths: "优点",
          issues: "问题",
          nextSteps: "建议",
          homeworkSummary: "作业建议",
          aiModel: "test-model",
          promptVersion: "test",
        })),
      /没有覆盖/,
    );
    const preserved = await prisma.teachingReport.findUniqueOrThrow({ where: { id: newest.report.id } });
    assert.equal(preserved.status, "PUBLISHED");
    assert.equal(preserved.summary, "HIST-NEWEST");

    const publishLesson = await addLesson(primary, {
      studentId: primary.student.id,
      courseId: primary.math.id,
      classGroupId: primary.mathClass.id,
      start: "2026-10-22T10:00:00+08:00",
      status: "DRAFT",
      summary: "待发布",
      privateNote: "SECRET-NOTE",
    });
    const parent = await prisma.user.create({
      data: { organizationId: primary.organization.id, email: `report-parent-a-${suffix}@edupilot.test`, passwordHash: "test-only", name: "测试家长", roles: ["PARENT"] },
    });
    const otherParent = await prisma.user.create({
      data: { organizationId: primary.organization.id, email: `report-parent-other-${suffix}@edupilot.test`, passwordHash: "test-only", name: "另一家长", roles: ["PARENT"] },
    });
    const foreignParent = await prisma.user.create({
      data: { organizationId: other.organization.id, email: `report-parent-b-${suffix}@edupilot.test`, passwordHash: "test-only", name: "外机构家长", roles: ["PARENT"] },
    });
    await prisma.parentStudentLink.create({ data: { organizationId: primary.organization.id, parentUserId: parent.id, studentId: primary.student.id } });
    await prisma.parentStudentLink.create({ data: { organizationId: primary.organization.id, parentUserId: otherParent.id, studentId: primary.otherStudent.id } });
    await prisma.parentStudentLink.create({ data: { organizationId: other.organization.id, parentUserId: foreignParent.id, studentId: other.student.id } });

    const teacher = { id: primary.teacherUser.id, organizationId: primary.organization.id, teacherId: primary.teacher.id };
    const owner = { id: primary.owner.id, organizationId: primary.organization.id };
    const blocked = await publishReportByOwner(prisma, owner, publishLesson.report.id);
    assert.equal(blocked.ok, false);
    assert.match(blocked.message ?? "", /只有授课教师可以发布报告/);
    assert.equal((await prisma.teachingReport.findUniqueOrThrow({ where: { id: publishLesson.report.id } })).status, "DRAFT");
    assert.equal(await prisma.auditLog.count({ where: { targetId: publishLesson.report.id, action: "REPORT_PUBLISHED" } }), 0);

    const confirmed = await publishReportByTeacher(prisma, teacher, publishLesson.report.id);
    assert.equal(confirmed.ok, true);
    const confirmedRow = await prisma.teachingReport.findUniqueOrThrow({ where: { id: publishLesson.report.id } });
    assert.equal(confirmedRow.status, "CONFIRMED");
    assert.equal(confirmedRow.publishedAt, null);
    assert.equal(confirmedRow.confirmedById, primary.teacherUser.id);
    assert.equal((await reportsVisibleToParent(prisma, { id: parent.id, organizationId: primary.organization.id })).some((item) => item.id === publishLesson.report.id), false);

    const ownerStillBlocked = await publishReportByOwner(prisma, owner, publishLesson.report.id);
    assert.equal(ownerStillBlocked.ok, false);
    assert.equal((await prisma.teachingReport.findUniqueOrThrow({ where: { id: publishLesson.report.id } })).status, "CONFIRMED");

    const outsider = await publishReportByOwner(prisma, { id: other.owner.id, organizationId: other.organization.id }, publishLesson.report.id);
    assert.equal(outsider.ok, false);
    const foreignTeacher = await publishReportByTeacher(prisma, { id: other.teacherUser.id, organizationId: other.organization.id, teacherId: other.teacher.id }, publishLesson.report.id);
    assert.equal(foreignTeacher.ok, false);
    assert.equal((await prisma.teachingReport.findUniqueOrThrow({ where: { id: publishLesson.report.id } })).status, "CONFIRMED");

    const published = await publishReportByTeacher(prisma, teacher, publishLesson.report.id);
    assert.equal(published.ok, true);
    const publishedRow = await prisma.teachingReport.findUniqueOrThrow({ where: { id: publishLesson.report.id } });
    assert.equal(publishedRow.status, "PUBLISHED");
    assert.equal(publishedRow.summary, "待发布");
    assert.equal(await prisma.auditLog.count({ where: { organizationId: primary.organization.id, targetId: publishLesson.report.id, action: "REPORT_PUBLISHED" } }), 1);
    const parentView = await reportsVisibleToParent(prisma, { id: parent.id, organizationId: primary.organization.id });
    assert.equal(parentView.some((item) => item.id === publishLesson.report.id), true);
    assert.equal(parentView.some((item) => item.summary === "HIST-DRAFT" || item.summary === "新草稿" || item.summary === "HIST-MIDDLE"), false);
    assert.equal(JSON.stringify(parentView).includes("SECRET-NOTE"), false);
    assert.equal((await reportsVisibleToParent(prisma, { id: otherParent.id, organizationId: primary.organization.id })).some((item) => item.id === publishLesson.report.id), false);
    assert.equal((await reportsVisibleToParent(prisma, { id: foreignParent.id, organizationId: other.organization.id })).some((item) => item.id === publishLesson.report.id), false);
    assert.equal((await prisma.teachingReport.count({ where: { organizationId: other.organization.id, id: publishLesson.report.id } })), 0);

    const returned = await returnReportByOwner(prisma, owner, publishLesson.report.id, "请补充例题");
    assert.equal(returned.ok, true);
    const returnedRow = await prisma.teachingReport.findUniqueOrThrow({ where: { id: publishLesson.report.id } });
    assert.equal(returnedRow.status, "RETURNED");
    assert.equal(returnedRow.summary, "待发布");
    assert.equal(returnedRow.revisionNote, "请补充例题");
    assert.equal(await prisma.auditLog.count({ where: { organizationId: primary.organization.id, targetId: publishLesson.report.id, action: "REPORT_RETURNED" } }), 1);
    assert.equal((await reportsVisibleToParent(prisma, { id: parent.id, organizationId: primary.organization.id })).some((item) => item.id === publishLesson.report.id), false);
    const foreignReturn = await returnReportByOwner(prisma, { id: other.owner.id, organizationId: other.organization.id }, publishLesson.report.id, "越权退回");
    assert.equal(foreignReturn.ok, false);
    assert.equal((await prisma.teachingReport.findUniqueOrThrow({ where: { id: publishLesson.report.id } })).revisionNote, "请补充例题");

    const reconfirmed = await publishReportByTeacher(prisma, teacher, publishLesson.report.id);
    assert.equal(reconfirmed.ok, true);
    assert.equal((await prisma.teachingReport.findUniqueOrThrow({ where: { id: publishLesson.report.id } })).status, "CONFIRMED");
    assert.equal((await reportsVisibleToParent(prisma, { id: parent.id, organizationId: primary.organization.id })).some((item) => item.id === publishLesson.report.id), false);
    const republished = await publishReportByTeacher(prisma, teacher, publishLesson.report.id);
    assert.equal(republished.ok, true);
    assert.equal((await prisma.teachingReport.findUniqueOrThrow({ where: { id: publishLesson.report.id } })).status, "PUBLISHED");
    assert.equal((await reportsVisibleToParent(prisma, { id: parent.id, organizationId: primary.organization.id })).some((item) => item.id === publishLesson.report.id), true);

    await prisma.organization.update({ where: { id: primary.organization.id }, data: { aiTeacherMustConfirm: false } });
    const direct = await addLesson(primary, {
      studentId: primary.student.id,
      courseId: primary.math.id,
      classGroupId: primary.mathClass.id,
      start: "2026-10-23T10:00:00+08:00",
      status: "DRAFT",
      summary: "开关关闭后仍不能由负责人发布",
    });
    const ownerDirect = await publishReportByOwner(prisma, owner, direct.report.id);
    assert.equal(ownerDirect.ok, false);
    assert.equal((await prisma.teachingReport.findUniqueOrThrow({ where: { id: direct.report.id } })).status, "DRAFT");

    const teacherDirectLesson = await addLesson(primary, {
      studentId: primary.student.id,
      courseId: primary.math.id,
      classGroupId: primary.mathClass.id,
      start: "2026-10-24T10:00:00+08:00",
      status: "DRAFT",
      summary: "教师一次发布",
    });
    const teacherDirect = await publishReportByTeacher(prisma, teacher, teacherDirectLesson.report.id);
    assert.equal(teacherDirect.ok, true);
    assert.equal("published" in teacherDirect, true);
    assert.equal((await prisma.teachingReport.findUniqueOrThrow({ where: { id: teacherDirectLesson.report.id } })).status, "PUBLISHED");
    assert.equal((await reportsVisibleToParent(prisma, { id: parent.id, organizationId: primary.organization.id })).some((item) => item.id === teacherDirectLesson.report.id), true);
  } finally {
    for (const organizationId of created) await cleanup(organizationId);
    await prisma.$disconnect();
  }
});

async function seedOrg(label: string) {
  const organization = await prisma.organization.create({
    data: { name: `报告测试 ${label} ${suffix}`, reportLanguage: label === "a" ? "zh-CN" : "en", aiTeacherMustConfirm: true, aiUseRecentSummaries: true },
  });
  const owner = await prisma.user.create({
    data: { organizationId: organization.id, email: `report-owner-${label}-${suffix}@edupilot.test`, passwordHash: "test-only", name: "测试负责人", roles: ["OWNER"] },
  });
  const teacherUser = await prisma.user.create({
    data: { organizationId: organization.id, email: `report-teacher-${label}-${suffix}@edupilot.test`, passwordHash: "test-only", name: "测试教师账号", roles: ["TEACHER"] },
  });
  const teacher = await prisma.teacher.create({
    data: { organizationId: organization.id, name: "测试教师", userId: teacherUser.id },
  });
  const student = await prisma.student.create({ data: { organizationId: organization.id, name: "测试学员" } });
  const otherStudent = await prisma.student.create({ data: { organizationId: organization.id, name: "另一学员" } });
  const math = await prisma.course.create({ data: { organizationId: organization.id, name: "测试数学" } });
  const art = await prisma.course.create({ data: { organizationId: organization.id, name: "测试美术" } });
  const mathClass = await prisma.classGroup.create({
    data: { organizationId: organization.id, name: "数学组", courseId: math.id, teacherId: teacher.id },
  });
  const artClass = await prisma.classGroup.create({
    data: { organizationId: organization.id, name: "美术组", courseId: art.id, teacherId: teacher.id },
  });
  return { organization, owner, teacherUser, teacher, student, otherStudent, math, art, mathClass, artClass };
}

async function addLesson(
  org: Awaited<ReturnType<typeof seedOrg>>,
  input: { studentId: string; courseId: string; classGroupId: string; start: string; status: ReportStatus; summary: string; privateNote?: string },
) {
  const startAt = new Date(input.start);
  const lesson = await prisma.lessonSession.create({
    data: {
      organizationId: org.organization.id,
      classGroupId: input.classGroupId,
      courseId: input.courseId,
      teacherId: org.teacher.id,
      startAt,
      endAt: new Date(startAt.getTime() + 60 * 60 * 1000),
      createdById: org.owner.id,
      students: { create: { organizationId: org.organization.id, studentId: input.studentId } },
    },
  });
  const record = await prisma.teachingRecord.create({
    data: {
      organizationId: org.organization.id,
      lessonSessionId: lesson.id,
      teacherId: org.teacher.id,
      lessonContent: "课堂内容",
      studentPerformance: "课堂表现",
      difficulties: "遇到的问题",
      homework: "作业",
      teacherPrivateNote: input.privateNote ?? null,
    },
  });
  const report = await prisma.teachingReport.create({
    data: {
      organizationId: org.organization.id,
      lessonSessionId: lesson.id,
      studentId: input.studentId,
      teachingRecordId: record.id,
      status: input.status,
      summary: input.summary,
      ...filled,
    },
  });
  return { lesson, record, report };
}

function draftScope(org: Awaited<ReturnType<typeof seedOrg>>, row: Awaited<ReturnType<typeof addLesson>>) {
  return {
    organizationId: org.organization.id,
    lessonSessionId: row.lesson.id,
    studentId: row.report.studentId,
    teachingRecordId: row.record.id,
    existingId: row.report.id,
  };
}

async function cleanup(organizationId: string) {
  await prisma.teachingReport.deleteMany({ where: { organizationId } });
  await prisma.teachingRecord.deleteMany({ where: { organizationId } });
  await prisma.lessonStudent.deleteMany({ where: { organizationId } });
  await prisma.lessonSession.deleteMany({ where: { organizationId } });
  await prisma.parentStudentLink.deleteMany({ where: { organizationId } });
  await prisma.classGroup.deleteMany({ where: { organizationId } });
  await prisma.course.deleteMany({ where: { organizationId } });
  await prisma.student.deleteMany({ where: { organizationId } });
  await prisma.teacher.deleteMany({ where: { organizationId } });
  await prisma.auditLog.deleteMany({ where: { organizationId } });
  await prisma.user.deleteMany({ where: { organizationId } });
  await prisma.organization.deleteMany({ where: { id: organizationId } });
}
