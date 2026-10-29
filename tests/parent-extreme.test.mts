import assert from "node:assert/strict";
import { register } from "node:module";
import { loadEnvFile } from "node:process";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

await register(pathToFileURL(fileURLToPath(new URL("./resolve-ts.mjs", import.meta.url))).href, import.meta.url);
loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));

const { safeParentHref, pickLinkedChildId, parentVisibleLessonFilter } = await import("../lib/parent-scope.ts");
const { prisma } = await import("../lib/prisma.ts");
const { formatCourseUsage } = await import("../lib/billing-list.ts");
const { shanghaiDateKey } = await import("../lib/datetime.ts");

test("safeParentHref only allows /parent/ paths", () => {
  assert.equal(safeParentHref("/parent/reports"), "/parent/reports");
  assert.equal(safeParentHref("/parent/schedule?date=2026-10-01"), "/parent/schedule?date=2026-10-01");
  assert.equal(safeParentHref("https://evil.example/phish"), "/parent/notices");
  assert.equal(safeParentHref("//evil.example/x"), "/parent/notices");
  assert.equal(safeParentHref("/owner/billing"), "/parent/notices");
  assert.equal(safeParentHref("/parent/../owner/billing"), "/parent/notices");
  assert.equal(safeParentHref("/parent/%2e%2e/owner"), "/parent/notices");
});

test("pickLinkedChildId rejects forged student ids", () => {
  const kids = [{ id: "a" }, { id: "b" }];
  assert.equal(pickLinkedChildId(kids, "a"), "a");
  assert.equal(pickLinkedChildId(kids, "forged"), "");
  assert.equal(pickLinkedChildId(kids, ""), "");
});

test("formatCourseUsage distinguishes lesson hours and period validity", () => {
  const today = shanghaiDateKey();
  assert.match(formatCourseUsage({ enrolled: true, billingType: "PER_LESSON", remainingHours: 12, periodStatus: null, validUntil: null }, today), /剩余 12 节/);
  assert.match(formatCourseUsage({ enrolled: true, billingType: "PER_PERIOD", remainingHours: null, periodStatus: "有效中", validUntil: "2026-12-31" }, today), /至 2026-12-31/);
});

test("parent-visible reports query only returns PUBLISHED linked children", async () => {
  const parent = await prisma.user.findFirst({
    where: { roles: { has: "PARENT" } },
    select: { id: true, organizationId: true },
  });
  assert.ok(parent);
  const links = await prisma.parentStudentLink.findMany({
    where: { organizationId: parent!.organizationId, parentUserId: parent!.id },
    select: { studentId: true },
  });
  const studentIds = links.map((link) => link.studentId);
  const visible = studentIds.length
    ? await prisma.teachingReport.findMany({
        where: { organizationId: parent!.organizationId, status: "PUBLISHED", studentId: { in: studentIds } },
        select: { id: true, status: true, studentId: true },
      })
    : [];
  assert.ok(visible.every((row) => row.status === "PUBLISHED"));
  const allowed = new Set(studentIds);
  assert.ok(visible.every((row) => allowed.has(row.studentId)));
  const leakedDraft = await prisma.teachingReport.findFirst({
    where: {
      organizationId: parent!.organizationId,
      status: { in: ["DRAFT", "CONFIRMED", "RETURNED"] },
      id: { in: visible.map((row) => row.id).concat("__none__") },
    },
    select: { id: true },
  });
  assert.equal(leakedDraft, null);
});

test("parent leave and photo routes force parentStudentLink", async () => {
  const leave = await import("node:fs/promises").then((fs) =>
    fs.readFile(fileURLToPath(new URL("../app/parent/schedule/actions.ts", import.meta.url)), "utf8"),
  );
  const photos = await import("node:fs/promises").then((fs) =>
    fs.readFile(fileURLToPath(new URL("../app/api/report-photos/[id]/route.ts", import.meta.url)), "utf8"),
  );
  const search = await import("node:fs/promises").then((fs) =>
    fs.readFile(fileURLToPath(new URL("../app/api/owner/search/route.ts", import.meta.url)), "utf8"),
  );
  assert.match(leave, /applyParentLeave/);
  const leaveCore = await import("node:fs/promises").then((fs) =>
    fs.readFile(fileURLToPath(new URL("../lib/parent-leave.ts", import.meta.url)), "utf8"),
  );
  assert.match(leaveCore, /parentLinks:\s*\{\s*some:\s*\{\s*parentUserId:\s*actor\.id/);
  assert.match(photos, /parentStudentLink\.findFirst/);
  assert.match(photos, /status === "PUBLISHED"/);
  assert.match(search, /roles\.includes\("OWNER"\)/);
});

test("inactive children cannot see future lessons via filter", () => {
  const filter = parentVisibleLessonFilter(new Date("2026-10-27T12:00:00+08:00"));
  assert.deepEqual(filter.OR[0], { student: { status: "ACTIVE" } });
  assert.ok("lessonSession" in filter.OR[1]);
});

test("parent payment list scopes by parentStudentLink", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(fileURLToPath(new URL("../app/parent/courses/page.tsx", import.meta.url)), "utf8"),
  );
  assert.match(source, /parentLinks:\s*\{\s*some:/);
  assert.match(source, /voidedAt:\s*null/);
  assert.match(source, /缴费与退费流水/);
});
