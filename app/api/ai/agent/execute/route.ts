import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { actorFor, executeAssistant } from "@/lib/assistant-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    const body = await request.json().catch(() => null);
    const area = body && typeof body === "object" && "area" in body && body.area === "teacher" ? "teacher" : body && typeof body === "object" && "area" in body && body.area === "owner" ? "owner" : null;
    const token = body && typeof body === "object" && "token" in body && typeof body.token === "string" ? body.token : "";
    if (!user || !area || !token) return Response.json({ ok: false, message: "这次确认无效，没有写入。" }, { status: 401 });
    const actor = await actorFor(user, area);
    if (!actor) return Response.json({ ok: false, message: "小星助教只对负责人和教师开放。" }, { status: 403 });
    const result = await executeAssistant(actor, token);
    if (result.ok) {
      revalidatePath("/owner/audit");
    }
    return Response.json(result);
  } catch {
    return Response.json({ ok: false, message: "没有写入成功，请稍后再试。" });
  }
}
