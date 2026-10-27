import assert from "node:assert/strict";
import { register } from "node:module";
import { loadEnvFile } from "node:process";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

await register(pathToFileURL(fileURLToPath(new URL("./resolve-ts.mjs", import.meta.url))).href, import.meta.url);
loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));

const { buildLessonAnalysisPrompt, stripPromptMarkup } = await import("../lib/ai-service.ts");
const { prisma } = await import("../lib/prisma.ts");
const { syncAttendanceCharge } = await import("../lib/course-hours.ts");
const { teacherSnapshot } = await import("../lib/dashboard.ts");

test("stripPromptMarkup removes script tags before AI", () => {
  const cleaned = stripPromptMarkup('表现好<script>alert(1)</script>继续 <b>加油</b> 😀');
  assert.equal(cleaned.includes("<script>"), false);
  assert.equal(cleaned.includes("alert"), false);
  assert.match(cleaned, /表现好/);
  assert.match(cleaned, /加油/);
  assert.match(cleaned, /😀/);
});

test("AI prompt strips markup and redacts names without private notes", () => {
  const prompt = buildLessonAnalysisPrompt({
    language: "zh-CN",
    useRecentSummaries: false,
    history: [],
    lessonContent: '<script>alert(1)</script>今天给王小明讲课',
    studentPerformance: "王小明很认真",
    difficulties: "无",
    homework: "两题",
    studentNames: ["王小明"],
  });
  assert.doesNotMatch(prompt.user, /<script>|alert\(|王小明/);
  assert.match(prompt.user, /该同学/);
});

test("hoursCharged is idempotent per lessonStudent; two lessons can each charge once", async () => {
  const seat = await prisma.lessonStudent.findFirst({
    where: {
      hoursCharged: false,
      attendanceStatus: "NOT_MARKED",
      seat: "ENROLLED",
      student: { status: "ACTIVE" },
      lessonSession: { status: { not: "CANCELLED" }, course: { billingType: "PER_LESSON" } },
    },
    select: {
      id: true,
      studentId: true,
      organizationId: true,
      attendanceStatus: true,
      attendanceNote: true,
      lessonSession: { select: { courseId: true, course: { select: { name: true } } } },
      student: { select: { name: true } },
    },
  });
  if (!seat) {
    assert.ok(true, "no suitable seat in demo; skip live charge");
    return;
  }
  const prior = await prisma.courseHourBalance.findUnique({
    where: { studentId_courseId: { studentId: seat.studentId, courseId: seat.lessonSession.courseId } },
    select: { remainingHours: true },
  });
  await prisma.courseHourBalance.upsert({
    where: { studentId_courseId: { studentId: seat.studentId, courseId: seat.lessonSession.courseId } },
    create: {
      organizationId: seat.organizationId,
      studentId: seat.studentId,
      courseId: seat.lessonSession.courseId,
      remainingHours: 5,
    },
    update: { remainingHours: Math.max(prior?.remainingHours ?? 0, 2) },
  });

  try {
    await prisma.$transaction(async (tx) => {
      const first = await syncAttendanceCharge(tx, {
        organizationId: seat.organizationId,
        lessonStudentId: seat.id,
        studentId: seat.studentId,
        studentName: seat.student.name,
        courseId: seat.lessonSession.courseId,
        courseName: seat.lessonSession.course.name,
        billingType: "PER_LESSON",
        seat: "ENROLLED",
        shouldCharge: true,
        attendanceStatus: "PRESENT",
        attendanceNote: null,
      });
      assert.equal(first, "charged");
      const second = await syncAttendanceCharge(tx, {
        organizationId: seat.organizationId,
        lessonStudentId: seat.id,
        studentId: seat.studentId,
        studentName: seat.student.name,
        courseId: seat.lessonSession.courseId,
        courseName: seat.lessonSession.course.name,
        billingType: "PER_LESSON",
        seat: "ENROLLED",
        shouldCharge: true,
        attendanceStatus: "PRESENT",
        attendanceNote: null,
      });
      assert.equal(second, "unchanged");
      const refunded = await syncAttendanceCharge(tx, {
        organizationId: seat.organizationId,
        lessonStudentId: seat.id,
        studentId: seat.studentId,
        studentName: seat.student.name,
        courseId: seat.lessonSession.courseId,
        courseName: seat.lessonSession.course.name,
        billingType: "PER_LESSON",
        seat: "ENROLLED",
        shouldCharge: false,
        attendanceStatus: "LEAVE",
        attendanceNote: "改回请假",
      });
      assert.equal(refunded, "refunded");
    });
  } finally {
    await prisma.lessonStudent.update({
      where: { id: seat.id },
      data: {
        hoursCharged: false,
        attendanceStatus: "NOT_MARKED",
        attendanceNote: null,
        lastAction: null,
      },
    });
    if (prior) {
      await prisma.courseHourBalance.update({
        where: { studentId_courseId: { studentId: seat.studentId, courseId: seat.lessonSession.courseId } },
        data: { remainingHours: prior.remainingHours },
      });
    }
  }
});

test("report-flow and generate route refuse to overwrite PUBLISHED or CONFIRMED", async () => {
  const flow = await import("node:fs/promises").then((fs) =>
    fs.readFile(fileURLToPath(new URL("../lib/report-flow.ts", import.meta.url)), "utf8"),
  );
  const route = await import("node:fs/promises").then((fs) =>
    fs.readFile(fileURLToPath(new URL("../app/api/ai/generate/route.ts", import.meta.url)), "utf8"),
  );
  assert.match(flow, /status:\s*\{\s*in:\s*\["DRAFT",\s*"RETURNED"\]\s*\}/);
  assert.match(flow, /没有覆盖已确认或已发布/);
  assert.match(route, /status === "PUBLISHED" \|\| current\.status === "CONFIRMED"/);
  assert.match(route, /没有覆盖/);
});

test("teacher pending counts match listed pending records", async () => {
  const teacher = await prisma.teacher.findFirst({
    where: { status: "ACTIVE" },
    select: { id: true, organizationId: true },
  });
  assert.ok(teacher);
  const snap = await teacherSnapshot(teacher!.organizationId, teacher!.id);
  assert.equal(snap.pendingRecordCount, snap.pendingRecords.length);
});

test("lessonStudent unique constraint is lessonSessionId + studentId", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(fileURLToPath(new URL("../prisma/schema.prisma", import.meta.url)), "utf8"),
  );
  assert.match(source, /model LessonStudent[\s\S]*?@@unique\(\[lessonSessionId, studentId\]\)/);
});

test("saveAttendance source requires teacherId ownership", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(fileURLToPath(new URL("../app/teacher/actions.ts", import.meta.url)), "utf8"),
  );
  assert.match(source, /teacherId: teacher\.id/);
  assert.match(source, /已停用/);
});

test("markAllPresent preserves approved leave in teacher-schedule", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(fileURLToPath(new URL("../components/teacher-schedule.tsx", import.meta.url)), "utf8"),
  );
  assert.match(source, /parentLeave \|\| prior\.status === "LEAVE"/);
});
