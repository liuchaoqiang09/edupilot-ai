import { createHmac, timingSafeEqual } from "crypto";
import type { Role } from "@prisma/client";

export const SESSION_COOKIE = "edupilot_session";

export type SessionPayload = {
  sub: string;
  organizationId: string;
  roles: Role[];
  exp: number;
};

const ROLES = new Set<Role>(["OWNER", "TEACHER", "PARENT"]);

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value) {
    throw new Error("未配置 AUTH_SECRET");
  }
  return value;
}

export function signSession(
  input: Omit<SessionPayload, "exp">,
  maxAgeSeconds: number,
) {
  const payload: SessionPayload = {
    ...input,
    exp: Math.floor(Date.now() / 1000) + maxAgeSeconds,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function readSession(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  let expected: string;
  try {
    expected = createHmac("sha256", secret()).update(body).digest("base64url");
  } catch {
    return null;
  }

  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (!parsed.sub || !parsed.organizationId || !Array.isArray(parsed.roles)) return null;
    if (!parsed.roles.every((role) => ROLES.has(role))) return null;
    if (typeof parsed.exp !== "number" || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}
