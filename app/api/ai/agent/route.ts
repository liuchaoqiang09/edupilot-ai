import { getCurrentUser } from "@/lib/auth";
import { actorFor, assistantTimeoutMessage, runAssistant } from "@/lib/assistant-agent";
import { limitAssistantChat, rateLimitResponse } from "@/lib/ai-rate";
import { opsLog } from "@/lib/ops-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    const body = await request.json().catch(() => null);
    const area =
      body && typeof body === "object" && "area" in body && body.area === "teacher"
        ? "teacher"
        : body && typeof body === "object" && "area" in body && body.area === "parent"
          ? "parent"
          : body && typeof body === "object" && "area" in body && body.area === "owner"
            ? "owner"
            : null;
    if (!user || !area) return Response.json({ ok: false, message: "请先登录后再使用小星助教。" }, { status: 401 });
    const limited = limitAssistantChat(user.id);
    if (!limited.ok) {
      opsLog("warn", "ai.agent.rate_limited", { userId: user.id, area, retryAfterSec: limited.retryAfterSec });
      return rateLimitResponse(limited.retryAfterSec);
    }
    const actor = await actorFor(user, area);
    if (!actor) return Response.json({ ok: false, message: "小星助教只对负责人、教师和家长开放。" }, { status: 403 });
    const mode = body && typeof body === "object" && "mode" in body ? body.mode : "agent";
    const reply = await runAssistant(actor, body && typeof body === "object" && "messages" in body ? body.messages : [], mode);
    if (!reply.ok) opsLog("warn", "ai.agent.reply_failed", { userId: user.id, area, message: reply.message });
    return Response.json(reply);
  } catch (error) {
    opsLog("error", "ai.agent.exception", { message: error instanceof Error ? error.message : "unknown" });
    return Response.json({ ok: false, message: assistantTimeoutMessage });
  }
}
