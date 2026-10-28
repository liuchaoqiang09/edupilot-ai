import assert from "node:assert/strict";
import test from "node:test";
import { helpIntent, isAskBlockedTool, modeContractPrompt } from "../lib/assistant-mode.ts";

test("用法问句命中 helpIntent，不抢办理", () => {
  assert.equal(helpIntent("怎么请假？"), true);
  assert.equal(helpIntent("家长为什么看不到报告"), true);
  assert.equal(helpIntent("问答模式和工作模式有什么区别"), true);
  assert.equal(helpIntent("小星能帮我收款吗"), true);
  assert.equal(helpIntent("报名入口在哪里"), true);
  assert.equal(helpIntent("能不能调课时"), true);
});

test("明确办理槽不命中 helpIntent，保护 Agent 办理", () => {
  assert.equal(helpIntent("帮林子涵请假明天英语"), false);
  assert.equal(helpIntent("给林子涵报名数学班"), false);
  assert.equal(helpIntent("请给二班排课"), false);
  assert.equal(helpIntent("帮我收林子涵100元"), false);
  assert.equal(helpIntent("调课时加2节"), false);
  assert.equal(helpIntent("系统已执行。结果：已请假"), false);
});

test("Ask 写入仍硬拦；契约提示含用法解答且保留办理约束", () => {
  assert.equal(isAskBlockedTool("execute_parent_leave"), true);
  assert.equal(isAskBlockedTool("execute_enrollment"), true);
  assert.equal(isAskBlockedTool("open_exact"), false);
  assert.equal(isAskBlockedTool("get_child_schedule"), false);

  const ask = modeContractPrompt("ask", "owner");
  assert.match(ask, /用法解答/);
  assert.match(ask, /禁止调用任何 execute_/);

  const agent = modeContractPrompt("agent", "teacher");
  assert.match(agent, /用法问句/);
  assert.match(agent, /不要为了像在办事而强行 execute_/);
  assert.match(agent, /查询→execute_→确认/);

  const parentAgent = modeContractPrompt("agent", "parent");
  assert.match(parentAgent, /用法问句/);
  assert.match(parentAgent, /有明确办理槽再办理/);
});
