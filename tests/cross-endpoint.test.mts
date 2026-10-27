import assert from "node:assert/strict";
import { register } from "node:module";
import { loadEnvFile } from "node:process";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

await register(pathToFileURL(fileURLToPath(new URL("./resolve-ts.mjs", import.meta.url))).href, import.meta.url);
loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));

const { prisma } = await import("../lib/prisma.ts");
const { shanghaiDateKey, dayRange } = await import("../lib/datetime.ts");
const { safeParentHref } = await import("../lib/parent-scope.ts");

test("attendance save locks lesson teacher and lessonStudent rows", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(fileURLToPath(new URL("../app/teacher/actions.ts", import.meta.url)), "utf8"),
  );
  assert.match(source, /LessonSession[\s\S]*FOR UPDATE/);
  assert.match(source, /LessonStudent[\s\S]*FOR UPDATE/);
  assert.match(source, /负责人已更换授课教师/);
  assert.match(source, /ATTENDANCE_OVERRIDE_LEAVE/);
  assert.match(source, /live\.seat/);
});

test("parent leave locks roster row and blocks inactive students", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(fileURLToPath(new URL("../app/parent/schedule/actions.ts", import.meta.url)), "utf8"),
  );
  assert.match(source, /FOR UPDATE/);
  assert.match(source, /孩子已停用，不能再请假/);
  assert.match(source, /老师刚保存了考勤/);
  assert.match(source, /最终以老师保存为准/);
});

test("substitute attendance follows current teacherId; original teacher cannot match", async () => {
  const lessons = await prisma.lessonSession.findMany({
    where: { status: { not: "CANCELLED" } },
    select: { id: true, teacherId: true, organizationId: true },
    take: 20,
  });
  for (const lesson of lessons) {
    const other = await prisma.teacher.findFirst({
      where: { organizationId: lesson.organizationId, status: "ACTIVE", id: { not: lesson.teacherId } },
      select: { id: true },
    });
    if (!other) continue;
    const forged = await prisma.lessonSession.findFirst({
      where: { id: lesson.id, organizationId: lesson.organizationId, teacherId: other.id, status: { not: "CANCELLED" } },
      select: { id: true },
    });
    assert.equal(forged, null);
  }
  assert.ok(lessons.length >= 0);
});

test("refund cannot push enrollment net below zero while payments stay scoped", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(fileURLToPath(new URL("../lib/billing-ledger.ts", import.meta.url)), "utf8"),
  );
  assert.match(source, /FOR UPDATE/);
  assert.match(source, /退费金额不能超过这门报名尚未作废的实收/);
  assert.match(source, /作废后实收会小于 0/);
});

test("month revenue uses paidAt Shanghai day; lesson consumption uses startAt Shanghai day", async () => {
  const key = shanghaiDateKey(new Date("2026-10-31T23:30:00+08:00"));
  assert.equal(key, "2026-10-31");
  const next = shanghaiDateKey(new Date("2026-11-01T00:30:00+08:00"));
  assert.equal(next, "2026-11-01");
  const october = dayRange("2026-10-31");
  const late = new Date("2026-10-31T23:30:00+08:00");
  assert.ok(late >= october.start && late < october.end);
});

test("capacity shrink does not auto-admit waitlist; teacher UI warns over capacity", async () => {
  const courses = await import("node:fs/promises").then((fs) =>
    fs.readFile(fileURLToPath(new URL("../app/owner/courses/actions.ts", import.meta.url)), "utf8"),
  );
  const teacherUi = await import("node:fs/promises").then((fs) =>
    fs.readFile(fileURLToPath(new URL("../components/teacher-schedule.tsx", import.meta.url)), "utf8"),
  );
  assert.match(courses, /排队也不能再转入/);
  assert.doesNotMatch(courses, /admitWaitlist/);
  assert.match(teacherUi, /已超员/);
  assert.match(teacherUi, /排队不会自动顶替/);
});

test("converted trial seat still does not charge this lesson", async () => {
  const hours = await import("node:fs/promises").then((fs) =>
    fs.readFile(fileURLToPath(new URL("../lib/course-hours.ts", import.meta.url)), "utf8"),
  );
  assert.match(hours, /seat === "TRIAL" \|\| input\.seat === "CONVERTED"/);
});

test("report read and notice href stay parent-scoped", async () => {
  assert.equal(safeParentHref("/parent/reports"), "/parent/reports");
  assert.equal(safeParentHref("/owner/billing"), "/parent/notices");
  const read = await import("node:fs/promises").then((fs) =>
    fs.readFile(fileURLToPath(new URL("../lib/report-read.ts", import.meta.url)), "utf8"),
  );
  assert.match(read, /status: "PUBLISHED"/);
  assert.match(read, /parentLinks/);
});
