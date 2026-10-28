/**
 * 生产侧结构化日志：只打 JSON 一行，便于采集；不写密钥与连接串。
 */

type OpsLevel = "info" | "warn" | "error";

function redact(value: string) {
  return value
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://***")
    .replace(/Bearer\s+\S+/gi, "Bearer ***")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***");
}

export function opsLog(
  level: OpsLevel,
  event: string,
  fields: Record<string, string | number | boolean | null | undefined> = {},
) {
  const payload: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    event,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    payload[key] = typeof value === "string" ? redact(value) : value;
  }
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}
