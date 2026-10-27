import { getCurrentUser } from "@/lib/auth";
import { actorFor, assistantTimeoutMessage, runAssistant } from "@/lib/assistant-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    const body = await request.json().catch(() => null);
    const area = body && typeof body === "object" && "area" in body && body.area === "teacher" ? "teacher" : body && typeof body === "object" && "area" in body && body.area === "owner" ? "owner" : null;
    if (!user || !area) return Response.json({ ok: false, message: "请先登录后再使用小星助教。" }, { status: 401 });
    const actor = await actorFor(user, area);
    if (!actor) return Response.json({ ok: false, message: "小星助教只对负责人和教师开放。" }, { status: 403 });
    const reply = await runAssistant(actor, body && typeof body === "object" && "messages" in body ? body.messages : []);
    return Response.json(reply);
  } catch {
    return Response.json({ ok: false, message: assistantTimeoutMessage });
  }
}
