import assert from "node:assert/strict";
import test from "node:test";
import {
  PARENT_ASK_TOOLS,
  isParentAskBlocked,
  parentPlaces,
  parentToolsFor,
} from "../lib/assistant-parent.ts";

test("家长 Ask 工具不含写入与教务名单", () => {
  assert.ok(PARENT_ASK_TOOLS.has("list_my_children"));
  assert.ok(PARENT_ASK_TOOLS.has("lookup_leave_seat"));
  assert.equal(PARENT_ASK_TOOLS.has("screen_students"), false);
  assert.equal(isParentAskBlocked("execute_parent_leave"), true);
  assert.equal(isParentAskBlocked("get_child_schedule"), false);
  assert.equal(isParentAskBlocked("search_student"), true);
});

test("家长工具白名单随模式切换", () => {
  const ask = parentToolsFor("ask").map((tool) => ("function" in tool ? tool.function.name : ""));
  const agent = parentToolsFor("agent").map((tool) => ("function" in tool ? tool.function.name : ""));
  assert.ok(ask.includes("open_exact"));
  assert.ok(ask.includes("get_child_courses"));
  assert.equal(ask.includes("execute_parent_leave"), false);
  assert.ok(agent.includes("execute_parent_leave"));
  assert.ok(agent.includes("execute_reply_report"));
  assert.ok(agent.includes("execute_mark_notices_read"));
  assert.equal(agent.includes("execute_enrollment"), false);
  assert.equal(agent.includes("execute_mark_attendance"), false);
});

test("家长可打开的位置不含教务后台词", () => {
  const text = parentPlaces.join(",");
  assert.match(text, /课程安排/);
  assert.match(text, /课时与费用/);
  assert.equal(/记录报名|收款流水|新增教师|机构设置/.test(text), false);
});
