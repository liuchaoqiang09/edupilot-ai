import assert from "node:assert/strict";
import test from "node:test";
import { PARENT_ASK_TOOLS, isParentAskBlocked, parentPlaces } from "../lib/assistant-parent.ts";
import { assertAssistantMayExecute } from "../lib/assistant-policy.ts";
import { pickLinkedChildId, safeParentHref } from "../lib/parent-scope.ts";
import { reportPhotoFolder, reportPhotoPath } from "../lib/report-photos.ts";
import { rateLimitKey, resetRateLimits, takeRateLimit } from "../lib/rate-limit.ts";

test("家长只能挑已绑定孩子 id，伪造 id 被忽略", () => {
  const children = [{ id: "stu_a" }, { id: "stu_b" }];
  assert.equal(pickLinkedChildId(children, "stu_a"), "stu_a");
  assert.equal(pickLinkedChildId(children, "stu_other_org"), "");
  assert.equal(pickLinkedChildId(children, ""), "");
  assert.equal(pickLinkedChildId(children, null), "");
});

test("家长跳转只允许 /parent 路径，拦截穿越", () => {
  assert.equal(safeParentHref("/parent/reports"), "/parent/reports");
  assert.equal(safeParentHref("/parent/notices?tab=1"), "/parent/notices?tab=1");
  assert.equal(safeParentHref("/owner/billing"), "/parent/notices");
  assert.equal(safeParentHref("/teacher/schedule"), "/parent/notices");
  assert.equal(safeParentHref("//evil.example"), "/parent/notices");
  assert.equal(safeParentHref("/parent/../owner"), "/parent/notices");
  assert.equal(safeParentHref("https://evil.example/parent/x"), "/parent/notices");
});

test("家长助教不能走教务写入与全机构名单工具", () => {
  assert.equal(PARENT_ASK_TOOLS.has("screen_students"), false);
  assert.equal(isParentAskBlocked("execute_enrollment"), true);
  assert.equal(isParentAskBlocked("execute_mark_attendance"), true);
  assert.equal(isParentAskBlocked("execute_parent_leave"), true);
  assert.equal(isParentAskBlocked("list_my_children"), false);
  assert.equal(/记录报名|收款流水|机构设置/.test(parentPlaces.join(",")), false);
});

test("助教三禁：财务与账号写入被拒", () => {
  assert.equal(assertAssistantMayExecute("execute_payment").ok, false);
  assert.equal(assertAssistantMayExecute("execute_adjust_hours").ok, false);
  assert.equal(assertAssistantMayExecute("bind_parent").ok, false);
  assert.equal(assertAssistantMayExecute("execute_student_crud", { action: "bind" }).ok, false);
  assert.equal(assertAssistantMayExecute("execute_enrollment").ok, true);
  assert.equal(assertAssistantMayExecute("execute_parent_leave").ok, true);
});

test("报告照片路径按机构隔离且净化目录名", () => {
  const pathA = reportPhotoPath("abc", "image/jpeg", "org_one");
  const pathB = reportPhotoPath("abc", "image/jpeg", "org_two");
  assert.notEqual(pathA, pathB);
  assert.match(pathA, /report-photos[/\\]org_one[/\\]abc\.jpg$/);
  const dirty = reportPhotoFolder("../evil;drop");
  assert.match(dirty, /report-photos[/\\]evildrop$/);
  assert.doesNotMatch(dirty, /\.\./);
});

test("限流：同 key 超窗口后拒绝并给出 retry", () => {
  resetRateLimits();
  const key = rateLimitKey(["test", "user-1"]);
  for (let i = 0; i < 3; i += 1) {
    const hit = takeRateLimit(key, { limit: 3, windowMs: 60_000 });
    assert.equal(hit.ok, true);
  }
  const blocked = takeRateLimit(key, { limit: 3, windowMs: 60_000 });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.ok(blocked.retryAfterSec >= 1);
  resetRateLimits();
});
