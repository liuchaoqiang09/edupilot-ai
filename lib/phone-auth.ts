import { createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { createSmsProvider, SmsUnavailableError, type SmsProvider } from "./sms";

type Db = PrismaClient | Prisma.TransactionClient;

const codeTtlMs = 5 * 60 * 1000;
const resendMs = 60 * 1000;
const hourMs = 60 * 60 * 1000;
const hourLimit = 5;
const ticketTtlMs = 10 * 60 * 1000;
const mainlandPhone = /^1[3-9]\d{9}$/;

export function normalizeMainlandPhone(value: string) {
  const digits = value.trim().replace(/[\s-]/g, "");
  const local = digits.startsWith("+86") ? digits.slice(3) : digits.startsWith("86") && digits.length === 13 ? digits.slice(2) : digits;
  return mainlandPhone.test(local) ? local : null;
}

function pepper() {
  const value = process.env.AUTH_SECRET?.trim();
  if (!value) throw new Error("未配置 AUTH_SECRET");
  return value;
}

function hashSecret(phone: string, secret: string) {
  return createHmac("sha256", pepper()).update(`${phone}:${secret}`).digest("hex");
}

function sameHash(left: string, right: string) {
  const actual = Buffer.from(left);
  const expected = Buffer.from(right);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function sendPhoneCode(
  db: Db,
  rawPhone: string,
  options?: { now?: Date; sms?: SmsProvider; randomCode?: () => string },
) {
  const phone = normalizeMainlandPhone(rawPhone);
  if (!phone) return { ok: false as const, status: 400, message: "请输入中国大陆手机号。" };
  const now = options?.now ?? new Date();
  const sms = options?.sms ?? createSmsProvider();
  const hourAgo = new Date(now.getTime() - hourMs);
  const recent = await db.phoneVerification.count({
    where: { phone, purpose: "code", createdAt: { gte: hourAgo } },
  });
  if (recent >= hourLimit) return { ok: false as const, status: 429, message: "获取验证码过于频繁，请一小时后再试。" };
  const latest = await db.phoneVerification.findFirst({
    where: { phone, purpose: "code" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (latest && now.getTime() - latest.createdAt.getTime() < resendMs) {
    return { ok: false as const, status: 429, message: "验证码已发送，请稍后再获取。" };
  }

  const code = options?.randomCode?.() ?? String(randomInt(0, 1_000_000)).padStart(6, "0");
  if (!/^\d{6}$/.test(code)) return { ok: false as const, status: 500, message: "验证码生成失败，请稍后重试。" };
  const row = await db.phoneVerification.create({
    data: {
      phone,
      purpose: "code",
      codeHash: hashSecret(phone, code),
      expiresAt: new Date(now.getTime() + codeTtlMs),
      createdAt: now,
    },
  });
  try {
    await sms.send(phone, code);
  } catch (error) {
    await db.phoneVerification.delete({ where: { id: row.id } });
    const message = error instanceof SmsUnavailableError ? error.message : "验证码发送失败，请稍后重试。";
    return { ok: false as const, status: 503, message };
  }
  return {
    ok: true as const,
    status: 200,
    message: "验证码已发送。",
    retryAfterSeconds: 60,
    devCode: sms.mode === "development" ? code : undefined,
  };
}

async function openCode(db: Db, phone: string) {
  return db.phoneVerification.findFirst({
    where: { phone, purpose: "code", consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
}

export async function verifyPhoneCode(db: Db, rawPhone: string, rawCode: string, options?: { now?: Date }) {
  const phone = normalizeMainlandPhone(rawPhone);
  const code = rawCode.trim();
  if (!phone) return { ok: false as const, status: 400, message: "请输入中国大陆手机号。" };
  if (!/^\d{6}$/.test(code)) return { ok: false as const, status: 400, message: "请输入 6 位数字验证码。" };
  const now = options?.now ?? new Date();
  const row = await openCode(db, phone);
  if (!row) return { ok: false as const, status: 400, message: "验证码不正确。" };
  if (row.expiresAt.getTime() <= now.getTime() || row.attempts >= row.maxAttempts) {
    await db.phoneVerification.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: now } });
    return { ok: false as const, status: 400, message: "验证码已过期或已失效，请重新获取。" };
  }
  if (!sameHash(row.codeHash, hashSecret(phone, code))) {
    const attempts = row.attempts + 1;
    await db.phoneVerification.update({
      where: { id: row.id },
      data: { attempts, consumedAt: attempts >= row.maxAttempts ? now : null },
    });
    return {
      ok: false as const,
      status: 400,
      message: attempts >= row.maxAttempts ? "验证码已失效，请重新获取。" : "验证码不正确。",
    };
  }

  const consumed = await db.phoneVerification.updateMany({
    where: { id: row.id, consumedAt: null },
    data: { consumedAt: now },
  });
  if (consumed.count !== 1) return { ok: false as const, status: 400, message: "验证码已失效，请重新获取。" };

  const user = await db.user.findUnique({
    where: { phone },
    select: { id: true, organizationId: true, roles: true, name: true },
  });
  if (user) return { ok: true as const, status: 200, kind: "login" as const, user };
  const signup = await db.phoneSignup.findUnique({ where: { phone }, select: { id: true } });
  if (signup) {
    const ticket = await issueActionTicket(db, phone, now);
    return {
      ok: true as const,
      status: 200,
      kind: "pending" as const,
      ticket,
      message: "这个手机号已登记。可以创建机构，或输入负责人发给你的邀请码。",
    };
  }

  return {
    ok: true as const,
    status: 200,
    kind: "register" as const,
    ticket: await createActionTicket(db, phone, now),
    message: "验证成功。这个手机号还没有账号，请填写姓名完成登记。",
  };
}

async function createActionTicket(db: Db, phone: string, now: Date) {
  const secret = randomBytes(32).toString("base64url");
  const ticketRow = await db.phoneVerification.create({
    data: {
      phone,
      purpose: "ticket",
      codeHash: hashSecret(phone, secret),
      expiresAt: new Date(now.getTime() + ticketTtlMs),
      createdAt: now,
    },
  });
  return `${ticketRow.id}.${secret}`;
}

export async function issueActionTicket(db: Db, phone: string, now = new Date()) {
  return createActionTicket(db, phone, now);
}

export async function openActionTicket(db: Db, rawTicket: string, now = new Date()) {
  const ticket = rawTicket.trim();
  const splitAt = ticket.indexOf(".");
  const ticketId = splitAt > 0 ? ticket.slice(0, splitAt) : "";
  const secret = splitAt > 0 ? ticket.slice(splitAt + 1) : "";
  if (!ticketId || !secret) return { ok: false as const, status: 400, message: "凭证已失效，请重新验证手机号。" };
  const row = await db.phoneVerification.findFirst({
    where: { id: ticketId, purpose: "ticket", consumedAt: null },
  });
  if (!row || row.expiresAt.getTime() <= now.getTime() || !sameHash(row.codeHash, hashSecret(row.phone, secret))) {
    return { ok: false as const, status: 400, message: "凭证已失效，请重新验证手机号。" };
  }
  return { ok: true as const, id: row.id, phone: row.phone };
}

export async function consumePhoneCode(db: Db, rawPhone: string, rawCode: string, now = new Date()) {
  const phone = normalizeMainlandPhone(rawPhone);
  const code = rawCode.trim();
  if (!phone) return { ok: false as const, status: 400, message: "请输入中国大陆手机号。" };
  if (!/^\d{6}$/.test(code)) return { ok: false as const, status: 400, message: "请输入 6 位数字验证码。" };
  const row = await openCode(db, phone);
  if (!row) return { ok: false as const, status: 400, message: "验证码不正确。" };
  if (row.expiresAt.getTime() <= now.getTime() || row.attempts >= row.maxAttempts) {
    await db.phoneVerification.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: now } });
    return { ok: false as const, status: 400, message: "验证码已过期或已失效，请重新获取。" };
  }
  if (!sameHash(row.codeHash, hashSecret(phone, code))) {
    const attempts = row.attempts + 1;
    await db.phoneVerification.update({
      where: { id: row.id },
      data: { attempts, consumedAt: attempts >= row.maxAttempts ? now : null },
    });
    return {
      ok: false as const,
      status: 400,
      message: attempts >= row.maxAttempts ? "验证码已失效，请重新获取。" : "验证码不正确。",
    };
  }
  const consumed = await db.phoneVerification.updateMany({
    where: { id: row.id, consumedAt: null },
    data: { consumedAt: now },
  });
  if (consumed.count !== 1) return { ok: false as const, status: 400, message: "验证码已失效，请重新获取。" };
  return { ok: true as const, phone };
}

export async function registerPhone(db: Db, rawTicket: string, rawName: string, options?: { now?: Date }) {
  const ticket = rawTicket.trim();
  const name = rawName.trim();
  const splitAt = ticket.indexOf(".");
  const ticketId = splitAt > 0 ? ticket.slice(0, splitAt) : "";
  const secret = splitAt > 0 ? ticket.slice(splitAt + 1) : "";
  if (!ticketId || !secret) return { ok: false as const, status: 400, message: "注册凭证已失效，请重新验证手机号。" };
  if (name.length < 2 || name.length > 40) return { ok: false as const, status: 400, message: "姓名需要 2 到 40 个字。" };
  const now = options?.now ?? new Date();
  const row = await db.phoneVerification.findFirst({
    where: { id: ticketId, purpose: "ticket", consumedAt: null },
  });
  if (!row || row.expiresAt.getTime() <= now.getTime() || !sameHash(row.codeHash, hashSecret(row.phone, secret))) {
    return { ok: false as const, status: 400, message: "注册凭证已失效，请重新验证手机号。" };
  }
  const existing = await db.user.findUnique({ where: { phone: row.phone }, select: { id: true } });
  if (existing) return { ok: false as const, status: 409, message: "这个手机号已有账号，请直接登录。" };
  const signup = await db.phoneSignup.findUnique({ where: { phone: row.phone }, select: { id: true } });
  if (signup) {
    return {
      ok: true as const,
      status: 200,
      ticket: await createActionTicket(db, row.phone, now),
      message: "这个手机号已经登记。你可以创建机构，或输入负责人发给你的邀请码。",
    };
  }

  try {
    const saved = await (db as PrismaClient).$transaction(async (tx) => {
      const consumed = await tx.phoneVerification.updateMany({
        where: { id: row.id, consumedAt: null },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) return false;
      await tx.phoneSignup.create({ data: { phone: row.phone, name } });
      return true;
    });
    if (!saved) return { ok: false as const, status: 400, message: "注册凭证已失效，请重新验证手机号。" };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
  }

  return {
    ok: true as const,
    status: 200,
    ticket: await createActionTicket(db, row.phone, now),
    message: "已登记。登记本身没有机构角色。你可以创建机构，或输入负责人发给你的邀请码。",
  };
}
