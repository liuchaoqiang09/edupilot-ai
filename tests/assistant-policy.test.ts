import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAssistantMayExecute,
  isAssistantAccountTool,
  isAssistantDeleteAttempt,
  isAssistantFinanceTool,
} from "../lib/assistant-policy.ts";

test("P1 三禁：删除 / 财务 / 账号写入被拒；排课点名报名放行", () => {
  assert.equal(isAssistantDeleteAttempt("delete_student"), true);
  assert.equal(isAssistantDeleteAttempt("execute_schedule_lesson"), false);
  assert.equal(isAssistantFinanceTool("execute_adjust_hours"), true);
  assert.equal(isAssistantFinanceTool("record_payment"), true);
  assert.equal(isAssistantFinanceTool("execute_enrollment"), false);
  assert.equal(isAssistantAccountTool("bind_parent"), true);
  assert.equal(isAssistantAccountTool("issue_teacher_invite"), true);
  assert.equal(isAssistantAccountTool("execute_student_crud", { action: "bind" }), true);
  assert.equal(isAssistantAccountTool("execute_student_crud", { action: "create" }), false);
  assert.equal(isAssistantAccountTool("execute_teacher_crud", { action: "invite" }), true);
  assert.equal(assertAssistantMayExecute("execute_schedule_lesson").ok, true);
  assert.equal(assertAssistantMayExecute("execute_mark_attendance").ok, true);
  assert.equal(assertAssistantMayExecute("execute_enrollment").ok, true);
  assert.equal(assertAssistantMayExecute("execute_payment").ok, false);
  assert.equal(assertAssistantMayExecute("execute_adjust_hours").ok, false);
  assert.equal(assertAssistantMayExecute("delete_anything").ok, false);
  assert.equal(assertAssistantMayExecute("bind_parent").ok, false);
});
