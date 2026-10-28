import { rateLimitKey, takeRateLimit } from "@/lib/rate-limit";

/** 小星对话：每用户每分钟 30 次。 */
export function limitAssistantChat(userId: string) {
  return takeRateLimit(rateLimitKey(["ai-agent", userId]), { limit: 30, windowMs: 60_000 });
}

/** 确认执行：每用户每分钟 20 次。 */
export function limitAssistantExecute(userId: string) {
  return takeRateLimit(rateLimitKey(["ai-execute", userId]), { limit: 20, windowMs: 60_000 });
}

/** 报告生成：每用户每分钟 8 次（一次可含多名学生）。 */
export function limitReportGenerate(userId: string) {
  return takeRateLimit(rateLimitKey(["ai-generate", userId]), { limit: 8, windowMs: 60_000 });
}

export function rateLimitResponse(retryAfterSec: number) {
  return Response.json(
    { ok: false, message: `请求过于频繁，请约 ${retryAfterSec} 秒后再试。` },
    { status: 429, headers: { "retry-after": String(retryAfterSec) } },
  );
}
