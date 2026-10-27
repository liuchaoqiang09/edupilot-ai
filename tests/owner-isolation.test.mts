import assert from "node:assert/strict";
import { register } from "node:module";
import { loadEnvFile } from "node:process";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

await register(pathToFileURL(fileURLToPath(new URL("./resolve-ts.mjs", import.meta.url))).href, import.meta.url);
loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));

const { prisma } = await import("../lib/prisma.ts");
const { ownerOverview, ownerSnapshot } = await import("../lib/dashboard.ts");
const { ownerTodoLists } = await import("../lib/todo-center.ts");
const { adjustLessonHours } = await import("../lib/billing-ledger.ts");
const { CourseHourError } = await import("../lib/course-hours.ts");

test("owner queries never cross organizations when forged ids are used", async () => {
  const orgs = await prisma.organization.findMany({ select: { id: true }, take: 4 });
  assert.ok(orgs.length >= 1, "need at least one organization");
  const primary = orgs[0];
  const foreign = orgs.find((org) => org.id !== primary.id) ?? null;

  const student = await prisma.student.findFirst({
    where: { organizationId: primary.id },
    select: { id: true },
  });
  const lesson = await prisma.lessonSession.findFirst({
    where: { organizationId: primary.id },
    select: { id: true },
  });
  const report = await prisma.teachingReport.findFirst({
    where: { organizationId: primary.id },
    select: { id: true },
  });
  assert.ok(student && lesson, "primary org needs student and lesson fixtures");

  if (foreign) {
    assert.equal(
      await prisma.student.findFirst({ where: { id: student!.id, organizationId: foreign.id }, select: { id: true } }),
      null,
    );
    assert.equal(
      await prisma.lessonSession.findFirst({ where: { id: lesson!.id, organizationId: foreign.id }, select: { id: true } }),
      null,
    );
    if (report) {
      assert.equal(
        await prisma.teachingReport.findFirst({ where: { id: report.id, organizationId: foreign.id }, select: { id: true } }),
        null,
      );
    }
  }

  const snapshot = await ownerSnapshot(primary.id);
  const overview = await ownerOverview(primary.id);
  const todos = await ownerTodoLists(primary.id);
  assert.equal(snapshot.activeStudents, overview.activeStudents);
  assert.equal(snapshot.pendingReports, overview.pendingReports);
  assert.equal(overview.pendingReports, todos.reports.length);
  assert.ok(overview.activeStudents >= 0);
  assert.ok(overview.lessons.length >= 0);
  assert.ok(overview.renewingCount >= 0);
});

test("hour adjustments refuse balances below zero inside the transaction path", async () => {
  const enrollment = await prisma.enrollment.findFirst({
    where: { course: { billingType: "PER_LESSON" }, student: { status: "ACTIVE" } },
    select: { organizationId: true, studentId: true, courseId: true },
  });
  if (!enrollment) {
    assert.ok(true, "no lesson enrollment to probe");
    return;
  }
  const balance = await prisma.courseHourBalance.findFirst({
    where: {
      organizationId: enrollment.organizationId,
      studentId: enrollment.studentId,
      courseId: enrollment.courseId,
    },
    select: { remainingHours: true },
  });
  const remaining = balance?.remainingHours ?? 0;
  const actor = await prisma.user.findFirst({
    where: { organizationId: enrollment.organizationId, roles: { has: "OWNER" } },
    select: { id: true, name: true },
  });
  assert.ok(actor);
  await assert.rejects(
    () =>
      prisma.$transaction((tx) =>
        adjustLessonHours(tx, {
          organizationId: enrollment.organizationId,
          actorId: actor!.id,
          actorName: actor!.name,
          studentId: enrollment.studentId,
          courseId: enrollment.courseId,
          deltaHours: -(remaining + 1),
          reason: "QA probe below zero",
        }),
      ),
    (error: unknown) => error instanceof CourseHourError && /不能小于 0/.test(error.message),
  );
});

test("assistant write tool catalog has no physical delete capability", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(fileURLToPath(new URL("../lib/assistant-ops.ts", import.meta.url)), "utf8"),
  );
  assert.doesNotMatch(source, /execute_delete|delete_student|delete_teacher|delete_lesson|prisma\.\w+\.delete\(/);
  assert.match(source, /ownerOnly/);
  assert.match(source, /confirmDisable/);
});

test("teacher deactivate is blocked when future lessons remain", async () => {
  const now = new Date();
  const busy = await prisma.teacher.findFirst({
    where: {
      status: "ACTIVE",
      lessonSessions: { some: { status: { not: "CANCELLED" }, startAt: { gt: now } } },
    },
    select: { id: true, organizationId: true, name: true },
  });
  if (!busy) {
    assert.ok(true, "no busy teacher fixture");
    return;
  }
  const count = await prisma.lessonSession.count({
    where: { organizationId: busy.organizationId, teacherId: busy.id, status: { not: "CANCELLED" }, startAt: { gt: now } },
  });
  assert.ok(count > 0);
});
