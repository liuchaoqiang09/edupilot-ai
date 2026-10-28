import assert from "node:assert/strict";
import test from "node:test";
import {
  ASK_ALLOWED_TOOLS,
  askModeBlockedMessage,
  isAskBlockedTool,
  modeContractPrompt,
  parseAssistantMode,
} from "../lib/assistant-mode.ts";

test("模式解析：默认工作，显式 ask", () => {
  assert.equal(parseAssistantMode(undefined), "agent");
  assert.equal(parseAssistantMode("agent"), "agent");
  assert.equal(parseAssistantMode("ask"), "ask");
  assert.equal(parseAssistantMode("nope"), "agent");
});

test("Ask 模式硬拦写入工具，放行查询与打开", () => {
  assert.equal(isAskBlockedTool("screen_students"), false);
  assert.equal(isAskBlockedTool("open_exact"), false);
  assert.equal(isAskBlockedTool("search_student"), false);
  assert.equal(isAskBlockedTool("lookup_lesson"), false);
  assert.equal(isAskBlockedTool("get_revenue_summary"), false);
  assert.equal(isAskBlockedTool("list_my_children"), false);
  assert.equal(isAskBlockedTool("get_child_schedule"), false);
  assert.equal(isAskBlockedTool("lookup_leave_seat"), false);
  assert.equal(isAskBlockedTool("execute_enrollment"), true);
  assert.equal(isAskBlockedTool("execute_mark_attendance"), true);
  assert.equal(isAskBlockedTool("execute_schedule_lesson"), true);
  assert.equal(isAskBlockedTool("execute_parent_leave"), true);
  assert.equal(isAskBlockedTool("execute_reply_report"), true);
  assert.equal(isAskBlockedTool("adjust_student_hours"), true);
  assert.equal(isAskBlockedTool("publish_report"), true);
  assert.ok(ASK_ALLOWED_TOOLS.has("get_pending_todos"));
  assert.match(askModeBlockedMessage(), /问答模式/);
  assert.match(askModeBlockedMessage("parent"), /请假或回复/);
});

test("模式契约提示含 Ask 只读与 Agent 办理", () => {
  const ask = modeContractPrompt("ask", "owner");
  assert.match(ask, /问答 Ask/);
  assert.match(ask, /禁止调用任何 execute_/);
  assert.match(ask, /用法解答/);
  const agent = modeContractPrompt("agent", "teacher");
  assert.match(agent, /工作 Agent/);
  assert.match(agent, /三禁/);
  assert.match(agent, /教师只能办理自己的课/);
  assert.match(agent, /用法问句/);
  const parentAsk = modeContractPrompt("ask", "parent");
  assert.match(parentAsk, /家长端/);
  assert.match(parentAsk, /禁止任何 execute_/);
  assert.match(parentAsk, /用法解答/);
  const parentAgent = modeContractPrompt("agent", "parent");
  assert.match(parentAgent, /请假/);
  assert.match(parentAgent, /禁止：教务写入/);
  assert.match(parentAgent, /用法问句/);
});

test("财务口语应命中三禁引导（与落地页规则一致）", () => {
  const compact = (text: string) => text.replace(/\s+/g, "");
  const financeAsk = (text: string) =>
    /收款|退费|作废流水|调课时|交\s*\d+|收\s*\d+\s*元|帮.+收/.test(compact(text));
  assert.equal(financeAsk("帮我收林子涵100元"), true);
  assert.equal(financeAsk("谁还欠费"), false);
  assert.equal(financeAsk("给林子涵报名"), false);
  assert.equal(financeAsk("调课时加2节"), true);
});
