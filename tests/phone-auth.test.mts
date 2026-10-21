import assert from "node:assert/strict";
import { register } from "node:module";
import { loadEnvFile } from "node:process";
import test from "node:test";
import { pathToFileURL, fileURLToPath } from "node:url";

await register(pathToFileURL(fileURLToPath(new URL("./resolve-ts.mjs", import.meta.url))).href, import.meta.url);
loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));

const { prisma } = await import("../lib/prisma.ts");
const { createSmsProvider, SmsUnavailableError } = await import("../lib/sms.ts");
const { registerPhone, sendPhoneCode, verifyPhoneCode } = await import("../lib/phone-auth.ts");
const { readSession, signSession } = await import("../lib/session.ts");

const suffix = `${Date.now()}`.slice(-8);
const phone = `138${suffix}`;
const otherPhone = `139${suffix}`;
const now = new Date("2026-10-21T12:00:00Z");

test("phone code rejects bad input, expiry, reuse, and duplicate signup", async () => {
  const created: string[] = [];
  try {
    assert.equal((await sendPhoneCode(prisma, "12345", { now })).ok, false);
    assert.equal((await verifyPhoneCode(prisma, phone, "12", { now })).message.includes("6 位"), true);

    const production = createSmsProvider({ NODE_ENV: "production", SMS_PROVIDER: "development" });
    await assert.rejects(() => production.send(phone, "000000"), SmsUnavailableError);
    const blocked = await sendPhoneCode(prisma, phone, { now, sms: production, randomCode: () => "000000" });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.status, 503);
    assert.equal(await prisma.phoneVerification.count({ where: { phone } }), 0);

    const sent = await sendPhoneCode(prisma, phone, { now, randomCode: () => "135790" });
    assert.equal(sent.ok, true);
    if (sent.ok) assert.equal(sent.devCode, "135790");
    assert.equal((await verifyPhoneCode(prisma, phone, "000000", { now })).message, "验证码不正确。");
    const expired = await verifyPhoneCode(prisma, phone, "135790", { now: new Date(now.getTime() + 6 * 60 * 1000) });
    assert.match(expired.ok ? "" : expired.message, /过期|失效/);

    const again = await sendPhoneCode(prisma, phone, { now: new Date(now.getTime() + 10 * 60 * 1000), randomCode: () => "246801" });
    assert.equal(again.ok, true);
    const first = await verifyPhoneCode(prisma, phone, "246801", { now: new Date(now.getTime() + 10 * 60 * 1000) });
    assert.equal(first.ok && first.kind, "register");
    const reused = await verifyPhoneCode(prisma, phone, "246801", { now: new Date(now.getTime() + 10 * 60 * 1000) });
    assert.equal(reused.ok, false);

    const ticket = first.ok && first.kind === "register" ? first.ticket : "";
    const registered = await registerPhone(prisma, ticket, "新用户", { now: new Date(now.getTime() + 10 * 60 * 1000) });
    assert.equal(registered.ok, true);
    assert.equal(await prisma.user.count({ where: { phone } }), 0);
    const duplicate = await registerPhone(prisma, ticket, "新用户", { now: new Date(now.getTime() + 11 * 60 * 1000) });
    assert.equal(duplicate.ok, false);
    const resent = await sendPhoneCode(prisma, phone, { now: new Date(now.getTime() + 20 * 60 * 1000), randomCode: () => "333333" });
    assert.equal(resent.ok, true);
    const pending = await verifyPhoneCode(prisma, phone, "333333", { now: new Date(now.getTime() + 20 * 60 * 1000) });
    assert.equal(pending.ok && pending.kind, "pending");

    const organization = await prisma.organization.create({ data: { name: `手机登录 ${suffix}` } });
    created.push(organization.id);
    const user = await prisma.user.create({
      data: {
        organizationId: organization.id,
        email: `phone-${suffix}@edupilot.test`,
        passwordHash: "test-only",
        name: "原账号",
        roles: ["TEACHER"],
        phone: otherPhone,
      },
    });
    const loginCode = await sendPhoneCode(prisma, otherPhone, { now, randomCode: () => "654321" });
    assert.equal(loginCode.ok, true);
    const loggedIn = await verifyPhoneCode(prisma, otherPhone, "654321", { now });
    assert.equal(loggedIn.ok && loggedIn.kind, "login");
    if (loggedIn.ok && loggedIn.kind === "login") {
      assert.deepEqual(loggedIn.user.roles, ["TEACHER"]);
      assert.equal(loggedIn.user.organizationId, organization.id);
      const token = signSession({ sub: user.id, organizationId: organization.id, roles: user.roles }, 60);
      assert.equal(readSession(token)?.sub, user.id);
      assert.equal(readSession(signSession({ sub: user.id, organizationId: organization.id, roles: user.roles }, -10)), null);
      assert.equal(readSession(""), null);
    }
    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.deepEqual(unchanged.roles, ["TEACHER"]);
    assert.equal(unchanged.organizationId, organization.id);
  } finally {
    await prisma.phoneVerification.deleteMany({ where: { phone: { in: [phone, otherPhone] } } });
    await prisma.phoneSignup.deleteMany({ where: { phone: { in: [phone, otherPhone] } } });
    for (const organizationId of created) {
      await prisma.user.deleteMany({ where: { organizationId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
    await prisma.$disconnect();
  }
});
