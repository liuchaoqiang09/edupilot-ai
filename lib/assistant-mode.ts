/**
 * 小星双模式：对齐主流 Agent 产品（Cursor / Cortex / Whale）。
 * Ask = 只读问答；Agent = 可办理（写操作仍须确认卡）。模式由服务端工具白名单强制，不只靠提示词。
 */

export type AssistantMode = "ask" | "agent";

export function parseAssistantMode(raw: unknown): AssistantMode {
  return raw === "ask" ? "ask" : "agent";
}

/** Ask 模式允许的工具名（查询 + 打开页面；禁止一切 execute_/写操作）。 */
export const ASK_ALLOWED_TOOLS = new Set([
  "screen_students",
  "open_exact",
  "search_student",
  "get_student_recent_reports",
  "get_overdue_students",
  "lookup_class",
  "lookup_course",
  "lookup_lesson",
  "lookup_teacher",
  "get_today_overview",
  "get_pending_todos",
  "get_teacher_schedule",
  "get_audit_logs",
  "get_stats_summary",
  "get_revenue_summary",
  // 家长端只读
  "list_my_children",
  "get_child_schedule",
  "get_child_attendance",
  "get_child_reports",
  "get_child_homework",
  "get_child_courses",
  "get_notices_summary",
  "lookup_leave_seat",
  "lookup_report",
]);

export function isAskBlockedTool(name: string) {
  if (name.startsWith("execute_")) return true;
  if (
    name.startsWith("adjust_") ||
    name.startsWith("create_") ||
    name.startsWith("schedule_") ||
    name === "publish_report" ||
    name === "record_payment" ||
    name === "bind_parent" ||
    name === "issue_teacher_invite"
  ) {
    return true;
  }
  return !ASK_ALLOWED_TOOLS.has(name);
}

export function askModeBlockedMessage(area: "owner" | "teacher" | "parent" = "owner") {
  if (area === "parent") {
    return "当前是「问答模式」，只能查询孩子信息和打开页面，不能请假或回复。请切换到「工作模式」后再让我办理。";
  }
  return "当前是「问答模式」，只能查询和打开页面，不能写入或办理。请切换到「工作模式」后再让我排课、点名、报名或改档案。";
}

/**
 * 用法 / FAQ 意图：怎么用、为什么、在哪——且没有明确办理槽。
 * 命中时不应强制 workOrder / tool_choice=required，以免削弱「只解答」。
 * 含办理槽（帮××请假、给××报名并带数量等）时返回 false，交给办理流程。
 */
export function helpIntent(text: string): boolean {
  const raw = text.trim();
  if (!raw || raw.startsWith("系统已执行")) return false;
  const compact = raw.replace(/\s+/g, "");

  // 「能不能帮我收款」是问能力；「帮我收款100」才是办理
  const askingCapability = /(能|会|可以)(不能|否)?帮/.test(compact) || /能不能|可不可以|可以吗|会不会/.test(compact);

  // 明确办理槽：祈使帮/给/为 + 业务动作，或带金额节数的写入口吻
  const hasWriteSlot =
    /交\s*\d+|\d+\s*(元|节)|收\s*\d+\s*元/.test(compact) ||
    (!askingCapability &&
      /(帮|给|为).{0,12}(请假|消假|报名|排课|点名|考勤|收款|退费|补课|发布|跟进|停用|取消课)/.test(compact)) ||
    /(请|麻烦|立刻|马上).{0,8}(请假|报名|排课|点名|发布报告)/.test(compact);

  if (hasWriteSlot) return false;

  // 纯用法 / 规则疑问
  if (/^(怎么|如何|怎样)(办|做|用|操作|请假|报名|排课|点名|发布)?/.test(compact)) return true;
  if (/为什么|为啥|怎么回事|在哪(里|儿)|哪个菜单|什么意思|能不能|可以吗|是否可以|有什么区别|区别是什么|怎么用|如何使用/.test(compact)) {
    return true;
  }
  if (/小星(能|会|可以)|问答模式|工作模式|确认卡|三禁/.test(compact) && /[?？]|吗|呢|吧|什么|怎么|如何/.test(raw + compact)) {
    return true;
  }
  if (askingCapability && /(收款|退费|调课时|请假|排课|点名|删除|邀请)/.test(compact)) return true;
  return false;
}

export function modeContractPrompt(mode: AssistantMode, area: "owner" | "teacher" | "parent") {
  if (area === "parent") {
    if (mode === "ask") {
      return [
        "【当前模式：问答 Ask · 只读 · 家长端】",
        "你可以查已绑定孩子的课表、出勤、报告、作业、通知、课时概况，解答本产品用法，并用 open_exact 打开家长页。",
        "用法问题按技能「用法解答」：解释规则与入口；默认不跳页，用户明确要打开再 open_exact。",
        "禁止任何 execute_。用户要请假/消假/回报告时，说明须切换到「工作模式」。",
        "不要查全机构名单、别人的孩子、教务后台或财务写入页。金额与课次必须来自工具。",
      ].join("\n");
    }
    return [
      "【当前模式：工作 Agent · 可办理 · 家长端】",
      "你是家长助手：查自己孩子；可办理请假、取消请假、回复已发布报告、标消息已读。流程：查询→execute_→确认卡。",
      "用法问句（怎么请假、为什么看不到报告）只解释或打开页，不要强行 execute_；有明确办理槽再办理。",
      "禁止：教务写入（报名/排课/点名/补课/改档案）、财务写、账号写、全机构名单、未绑定孩子。",
      "课时与费用只可查询与打开「课时与费用」页，不能代收代退。",
      "缺孩子姓名或课次时只补问一项；编号只能来自 lookup_/get_ 工具。",
    ].join("\n");
  }
  if (mode === "ask") {
    return [
      "【当前模式：问答 Ask · 只读】",
      "你可以查名单、查课表、查报告、解释规则与产品用法，并用 open_exact / screen_students 打开核对页。",
      "用法问题按技能「用法解答」回答；禁止调用任何 execute_ 或其它写入工具。",
      "即使用户要求办理，也只说明步骤，并明确请其切换到「工作模式」。不要假装已经办理成功。",
      "金额、人数、课次必须来自工具返回值。",
      area === "teacher" ? "教师只能看自己的学生与课次。" : "负责人可查本机构经营与教务数据。",
    ].join("\n");
  }
  return [
    "【当前模式：工作 Agent · 可办理】",
    "你是教务执行副驾：信息够就查编号、立刻发起 execute_，由系统弹出确认卡后写入。",
    "不要只聊天、不要只打开页面了事。办理类必须走查询→execute_→确认。",
    "用法问句（怎么用、为什么、在哪）按技能「用法解答」：只解释或 open_exact，不要为了像在办事而强行 execute_。",
    "三禁仍禁止主动写入：删除、财务（收款/退费/作废/调课时）、账号（邀请码/改密换绑）。三禁时用 open_exact 打开入口并说明须人在页面操作。",
    "停用学生/教师、停一门报名、取消课次等后果明显的操作：确认卡 detail 必须写清后果，等人点确认。",
    "缺的只有一项时只补问那一项，问完继续查并调用 execute_。",
    "禁止编造编号、金额、课时。编号只能来自查询工具。",
    area === "teacher"
      ? "教师只能办理自己的课、自己的班、自己的学生；不能办全机构财务写入、教师档案、教室、机构设置。"
      : "负责人可办理本机构教务与教学写入（在三禁之外）。",
  ].join("\n");
}
