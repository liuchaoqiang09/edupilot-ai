import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { actorFor, executeAssistant } from "@/lib/assistant-agent";
import { limitAssistantExecute, rateLimitResponse } from "@/lib/ai-rate";
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
    const token = body && typeof body === "object" && "token" in body && typeof body.token === "string" ? body.token : "";
    if (!user || !area || !token) return Response.json({ ok: false, message: "这次确认无效，没有写入。" }, { status: 401 });
    const limited = limitAssistantExecute(user.id);
    if (!limited.ok) {
      opsLog("warn", "ai.execute.rate_limited", { userId: user.id, area, retryAfterSec: limited.retryAfterSec });
      return rateLimitResponse(limited.retryAfterSec);
    }
    const actor = await actorFor(user, area);
    if (!actor) return Response.json({ ok: false, message: "小星助教只对负责人、教师和家长开放。" }, { status: 403 });
    const result = await executeAssistant(actor, token);
    if (result.ok) {
      opsLog("info", "ai.execute.ok", { userId: user.id, area });
      revalidatePath("/owner/audit");
      if (area === "parent") {
        revalidatePath("/parent");
        revalidatePath("/parent/schedule");
        revalidatePath("/parent/reports");
        revalidatePath("/parent/notices");
      }
    } else {
      opsLog("warn", "ai.execute.failed", { userId: user.id, area, message: result.message });
    }
    return Response.json(result);
  } catch (error) {
    opsLog("error", "ai.execute.exception", { message: error instanceof Error ? error.message : "unknown" });
    return Response.json({ ok: false, message: "没有写入成功，请稍后再试。" });
  }
}
