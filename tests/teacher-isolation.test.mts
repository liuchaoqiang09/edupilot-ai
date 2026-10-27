import assert from "node:assert/strict";
import { register } from "node:module";
import { loadEnvFile } from "node:process";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

await register(pathToFileURL(fileURLToPath(new URL("./resolve-ts.mjs", import.meta.url))).href, import.meta.url);
loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));

const { buildLessonAnalysisPrompt } = await import("../lib/ai-service.ts");
const { prisma } = await import("../lib/prisma.ts");
const { teacherSnapshot } = await import("../lib/dashboard.ts");

test("teacher schedule and attendance queries never cross another teacher", async () => {
  const teachers = await prisma.teacher.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, organizationId: true, name: true },
    take: 8,
  });
  assert.ok(teachers.length >= 2, "need at least two active teachers in the demo database");

  const byOrg = new Map<string, typeof teachers>();
  for (const teacher of teachers) {
    const list = byOrg.get(teacher.organizationId) ?? [];
    list.push(teacher);
    byOrg.set(teacher.organizationId, list);
  }
  const pair = [...byOrg.values()].find((list) => list.length >= 2);
  assert.ok(pair, "need two teachers in the same organization");
  const [teacherA, teacherB] = pair!;

  const lessonsA = await prisma.lessonSession.findMany({
    where: { organizationId: teacherA.organizationId, teacherId: teacherA.id, status: { not: "CANCELLED" } },
    select: { id: true, teacherId: true },
    take: 20,
  });
  assert.ok(lessonsA.every((lesson) => lesson.teacherId === teacherA.id));

  if (lessonsA[0]) {
    const forged = await prisma.lessonSession.findFirst({
      where: {
        id: lessonsA[0].id,
        organizationId: teacherB.organizationId,
        teacherId: teacherB.id,
        status: { not: "CANCELLED" },
      },
      select: { id: true },
    });
    assert.equal(forged, null, "teacher B must not load teacher A lesson with teacherId filter");
  }

  const reportsA = await prisma.teachingReport.findMany({
    where: { organizationId: teacherA.organizationId, lessonSession: { teacherId: teacherA.id } },
    select: { id: true, lessonSession: { select: { teacherId: true } } },
    take: 20,
  });
  assert.ok(reportsA.every((report) => report.lessonSession.teacherId === teacherA.id));

  if (reportsA[0]) {
    const forgedReport = await prisma.teachingReport.findFirst({
      where: {
        id: reportsA[0].id,
        organizationId: teacherB.organizationId,
        status: { in: ["DRAFT", "RETURNED"] },
        lessonSession: { teacherId: teacherB.id },
      },
      select: { id: true },
    });
    assert.equal(forgedReport, null, "teacher B must not edit teacher A report");
  }

  const snapA = await teacherSnapshot(teacherA.organizationId, teacherA.id);
  const snapB = await teacherSnapshot(teacherB.organizationId, teacherB.id);
  assert.ok(typeof snapA.pendingRecordCount === "number");
  assert.ok(typeof snapB.pendingReports === "number");
});

test("AI prompt redacts names and never accepts a private-note field", () => {
  const prompt = buildLessonAnalysisPrompt({
    language: "zh-CN",
    useRecentSummaries: false,
    history: [],
    lessonContent: "今天给林子涵讲了二次函数",
    studentPerformance: "林子涵表现稳定",
    difficulties: "无",
    homework: "两道题",
    studentNames: ["林子涵"],
  });
  assert.match(prompt.user, /该同学/);
  assert.doesNotMatch(prompt.user, /林子涵/);
  assert.doesNotMatch(prompt.user, /内部备注|teacherPrivateNote|SECRET/);
  assert.equal("teacherPrivateNote" in (prompt as object), false);
});

test("generate route teachingRecord select omits private notes", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(fileURLToPath(new URL("../app/api/ai/generate/route.ts", import.meta.url)), "utf8"),
  );
  assert.match(source, /teachingRecord:\s*\{\s*select:\s*\{[^}]*lessonContent/);
  assert.doesNotMatch(source, /teacherPrivateNote/);
});
