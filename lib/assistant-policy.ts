/**
 * 小星助教权限：默认可主动办理教务与教学；仅三禁不能主动写入。
 * 1) 删除（物理删除）
 * 2) 财务（收款、退费、作废、手工调课时）
 * 3) 账号修改（登录邀请、家长绑定码、改密/换绑等）
 * 报名建档可主动；实收须人在财务页操作。查询类一律允许。
 */

export const ASSISTANT_FINANCE_TOOLS = new Set([
  "adjust_student_hours",
  "adjust_hours",
  "execute_adjust_hours",
  "record_payment",
  "execute_payment",
]);

export const ASSISTANT_ACCOUNT_TOOLS = new Set([
  "bind_parent",
  "issue_teacher_invite",
]);

/** student_crud / teacher_crud 里禁止的 action */
export const ASSISTANT_ACCOUNT_ACTIONS = new Set(["bind", "invite"]);

export function isAssistantDeleteAttempt(name: string) {
  return /delete|remove|drop|销毁/i.test(name) || name.includes("删除");
}

export function isAssistantFinanceTool(name: string) {
  return ASSISTANT_FINANCE_TOOLS.has(name);
}

export function isAssistantAccountTool(name: string, args?: Record<string, unknown>) {
  if (ASSISTANT_ACCOUNT_TOOLS.has(name)) return true;
  if (name === "execute_student_crud" && ASSISTANT_ACCOUNT_ACTIONS.has(String(args?.action ?? ""))) return true;
  if (name === "execute_teacher_crud" && ASSISTANT_ACCOUNT_ACTIONS.has(String(args?.action ?? ""))) return true;
  return false;
}

export function assistantForbiddenMessage(kind: "delete" | "finance" | "account") {
  if (kind === "delete") return "小星助教不能删除数据。停用、归档、取消课次可以办；物理删除请在对应页面由负责人处理。";
  if (kind === "finance") {
    return "小星助教不能主动改财务：收款、退费、作废和手工调课时请到「报名与课时」页面操作。我可以帮你查欠费、收入，并打开对应页面。";
  }
  return "小星助教不能主动改账号：登录邀请、家长绑定码、改密或换绑请到账号相关页面操作。我可以打开对应入口。";
}

export function assertAssistantMayExecute(name: string, args: Record<string, unknown> = {}): { ok: true } | { ok: false; message: string } {
  if (isAssistantDeleteAttempt(name)) return { ok: false, message: assistantForbiddenMessage("delete") };
  if (isAssistantFinanceTool(name)) return { ok: false, message: assistantForbiddenMessage("finance") };
  if (isAssistantAccountTool(name, args)) return { ok: false, message: assistantForbiddenMessage("account") };
  return { ok: true };
}
