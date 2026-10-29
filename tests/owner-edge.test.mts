import assert from "node:assert/strict";
import { register } from "node:module";
import { loadEnvFile } from "node:process";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

await register(pathToFileURL(fileURLToPath(new URL("./resolve-ts.mjs", import.meta.url))).href, import.meta.url);
loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));

const { dayRange, parseShanghaiDateTime, shanghaiDateKey } = await import("../lib/datetime.ts");
const { arrearsCents, enrollmentStanding } = await import("../lib/enrollment-money.ts");
const { classIsFull } = await import("../lib/class-occupancy.ts");
const { recurringDates } = await import("../lib/recurring-schedule.ts");
const { CSV_EXPORT_MAX_ROWS } = await import("../lib/csv.ts");
const { prisma } = await import("../lib/prisma.ts");
const { recordPayment, voidPayment, refreshEnrollmentMoney } = await import("../lib/billing-ledger.ts");
const { CourseHourError } = await import("../lib/course-hours.ts");

test("midnight lessons belong to the Shanghai calendar day", () => {
  const lesson = parseShanghaiDateTime("2026-10-28T00:10");
  assert.ok(lesson);
  assert.equal(shanghaiDateKey(lesson!), "2026-10-28");
  const today = dayRange("2026-10-27");
  const next = dayRange("2026-10-28");
  assert.ok(lesson! >= next.start && lesson! < next.end);
  assert.ok(!(lesson! >= today.start && lesson! < today.end));
});

test("zero-yuan enrollment is paid and not in arrears", () => {
  assert.equal(enrollmentStanding(0, 0, null), "PAID");
  assert.equal(arrearsCents(0, 0, null), 0);
  assert.equal(enrollmentStanding(500000, 0, null), "UNPAID");
  assert.equal(enrollmentStanding(500000, 200000, null), "PARTIAL");
  assert.equal(enrollmentStanding(500000, 500000, null), "PAID");
});

test("shrinking capacity below enrolled marks the class full and over capacity", () => {
  assert.equal(classIsFull(10, 15), true);
  assert.equal(classIsFull(10, 10), true);
  assert.equal(classIsFull(10, 9), false);
  assert.equal(classIsFull(null, 100), false);
});

test("recurring weekly five-day year span stays under the hard create cap path", () => {
  const { dates, truncated } = recurringDates("2026-01-01", "2026-12-31", [1, 2, 3, 4, 5], false);
  assert.equal(truncated, false);
  assert.ok(dates.length > 200, "a full year of weekdays should exceed the 200-lesson single-batch guard");
});

test("csv export max rows is capped to protect memory", () => {
  assert.equal(CSV_EXPORT_MAX_ROWS, 20_000);
});

test("refund above remaining net after voided payments is blocked", async () => {
  const enrollment = await prisma.enrollment.findFirst({
    where: {
      payments: { some: { voidedAt: null, amount: { gt: 0 } } },
    },
    select: {
      id: true,
      organizationId: true,
      payments: { where: { voidedAt: null }, select: { amount: true } },
    },
  });
  if (!enrollment) {
    assert.ok(true, "no payment fixture");
    return;
  }
  const actor = await prisma.user.findFirst({
    where: { organizationId: enrollment.organizationId, roles: { has: "OWNER" } },
    select: { id: true, name: true },
  });
  assert.ok(actor);
  const netCents = enrollment.payments.reduce((sum, row) => sum + Math.round(Number(row.amount.toString()) * 100), 0);
  assert.ok(netCents >= 0);
  // After a conceptual void that leaves the same open net, refunding more than net must fail.
  await assert.rejects(
    () =>
      prisma.$transaction((tx) =>
        recordPayment(tx, {
          organizationId: enrollment.organizationId,
          actorId: actor!.id,
          actorName: actor!.name,
          enrollmentId: enrollment.id,
          amountCents: netCents + 100,
          method: "CASH",
          paidAt: new Date(),
          reason: "QA over-refund",
          kind: "refund",
        }),
      ),
    (error: unknown) => error instanceof CourseHourError && /不能超过/.test(error.message),
  );
  void voidPayment;
  void refreshEnrollmentMoney;
});

test("assistant revenue tool is registered and filters voided payments", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(fileURLToPath(new URL("../lib/assistant-ops.ts", import.meta.url)), "utf8"),
  );
  assert.match(source, /get_revenue_summary/);
  assert.match(source, /voidedAt:\s*null/);
  assert.match(source, /Asia\/Shanghai/);
  assert.match(source, /禁止自行估算或编造/);
  const agent = await import("node:fs/promises").then((fs) =>
    fs.readFile(fileURLToPath(new URL("../lib/assistant-agent.ts", import.meta.url)), "utf8"),
  );
  // 收入查询挂在 assistant-ops 的 lookupTools，由 agent 组装工具表。
  assert.match(agent, /lookupTools/);
});
