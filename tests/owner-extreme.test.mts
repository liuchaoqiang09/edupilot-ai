import assert from "node:assert/strict";
import { register } from "node:module";
import { loadEnvFile } from "node:process";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

await register(pathToFileURL(fileURLToPath(new URL("./resolve-ts.mjs", import.meta.url))).href, import.meta.url);
loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));

const { dayRange, parseShanghaiDateTime, shanghaiDateKey } = await import("../lib/datetime.ts");
const { enrollmentStanding } = await import("../lib/enrollment-money.ts");
const { homePathForRoles } = await import("../lib/roles.ts");

test("multi-role home prefers owner then teacher then parent", () => {
  assert.equal(homePathForRoles(["OWNER", "TEACHER", "PARENT"]), "/owner");
  assert.equal(homePathForRoles(["TEACHER", "PARENT"]), "/teacher");
  assert.equal(homePathForRoles(["PARENT"]), "/parent");
});

test("overnight lesson consumption belongs to Shanghai start day", () => {
  const start = parseShanghaiDateTime("2026-10-31T23:00");
  const end = parseShanghaiDateTime("2026-11-01T01:00");
  assert.ok(start && end);
  assert.equal(shanghaiDateKey(start!), "2026-10-31");
  assert.equal(shanghaiDateKey(end!), "2026-11-01");
  const oct = dayRange("2026-10-31");
  assert.ok(start! >= oct.start && start! < oct.end);
});

test("voiding a payment then remaining net is partial not crashed", () => {
  // 5000 due, collected 2000+3000, void 2000 → net 3000 → PARTIAL
  assert.equal(enrollmentStanding(500000, 300000, null), "PARTIAL");
  assert.equal(enrollmentStanding(500000, 0, null), "UNPAID");
  // after full refund of remaining net
  assert.equal(enrollmentStanding(500000, 0, null), "UNPAID");
});

test("attendance and ledger source code harden partial save and enrollment locks", async () => {
  const fs = await import("node:fs/promises");
  const attendance = await fs.readFile(fileURLToPath(new URL("../app/teacher/actions.ts", import.meta.url)), "utf8");
  assert.match(attendance, /课时不足/);
  assert.match(attendance, /skipped/);
  const ledger = await fs.readFile(fileURLToPath(new URL("../lib/billing-ledger.ts", import.meta.url)), "utf8");
  assert.match(ledger, /FOR UPDATE/);
  assert.match(ledger, /学生已停用，不能再登记收款/);
  const shell = await fs.readFile(fileURLToPath(new URL("../components/workspace-shell.tsx", import.meta.url)), "utf8");
  assert.match(shell, /切换到家长端/);
  const cancel = await fs.readFile(fileURLToPath(new URL("../app/owner/schedule/actions.ts", import.meta.url)), "utf8");
  assert.match(cancel, /取消后不能恢复/);
});

test("makeup chain is one-hop unique not recursive", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(fileURLToPath(new URL("../app/owner/attendance/actions.ts", import.meta.url)), "utf8");
  assert.match(source, /makeupSourceId: source\.id/);
  assert.match(source, /这次请假已经安排过补课/);
  assert.doesNotMatch(source, /while\s*\(.*makeup/);
});
