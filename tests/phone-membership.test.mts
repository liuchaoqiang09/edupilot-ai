import assert from "node:assert/strict";
import { register } from "node:module";
import { loadEnvFile } from "node:process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import bcrypt from "bcryptjs";

await register(pathToFileURL(fileURLToPath(new URL("./resolve-ts.mjs", import.meta.url))).href, import.meta.url);
loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));

const { prisma } = await import("../lib/prisma.ts");
const { registerPhone, sendPhoneCode, verifyPhoneCode, issueActionTicket } = await import("../lib/phone-auth.ts");
const { bindUserPhone, createParentInvite, createTeacherInvite, redeemMembershipInvite } = await import("../lib/membership.ts");

const suffix = `${Date.now()}`.slice(-8);
const now = new Date();
const phones = {
  bound: `136${suffix}`,
  taken: `137${suffix}`,
  owner: `131${suffix}`,
  teacher: `132${suffix}`,
  parent: `133${suffix}`,
  cross: `135${suffix}`,
};
const orgIds: string[] = [];

async function post(path: string, body: Record<string, unknown>) {
  const response = await fetch(`http://127.0.0.1:3000${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null) as { redirect?: string; message?: string } | null;
  return { status: response.status, json };
}

async function signupTicket(phone: string, name: string, at: Date) {
  const sent = await sendPhoneCode(prisma, phone, { now: at, randomCode: () => "135790" });
  assert.equal(sent.ok, true);
  const verified = await verifyPhoneCode(prisma, phone, "135790", { now: at });
  assert.equal(verified.ok && verified.kind, "register");
  const registered = await registerPhone(prisma, verified.ok && verified.kind === "register" ? verified.ticket : "", name, { now: at });
  assert.equal(registered.ok, true);
  return registered.ok ? registered.ticket : "";
}

async function cleanup() {
  if (orgIds.length > 0) {
    await prisma.membershipInvite.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.parentStudentLink.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.teacher.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.student.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  }
  await prisma.phoneVerification.deleteMany({ where: { phone: { in: Object.values(phones) } } });
  await prisma.phoneSignup.deleteMany({ where: { phone: { in: Object.values(phones) } } });
}

test("existing account binds a phone without changing access, then logs in with the code", async () => {
  const password = "bind-pass-2026";
  const organization = await prisma.organization.create({ data: { name: `绑定测试 ${suffix}` } });
  orgIds.push(organization.id);
  const student = await prisma.student.create({ data: { organizationId: organization.id, name: "绑定学生", studentNo: `B-${suffix}` } });
  const user = await prisma.user.create({
    data: {
      organizationId: organization.id,
      email: `bind-${suffix}@edupilot.test`,
      passwordHash: await bcrypt.hash(password, 12),
      name: "原教师家长",
      roles: ["TEACHER", "PARENT"],
    },
  });
  await prisma.parentStudentLink.create({ data: { organizationId: organization.id, parentUserId: user.id, studentId: student.id } });
  const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

  const sent = await sendPhoneCode(prisma, phones.bound, { now, randomCode: () => "246801" });
  assert.equal(sent.ok, true);
  const wrongPassword = await bindUserPhone(prisma, user.id, "wrong-password", phones.bound, "246801", { now });
  assert.equal(wrongPassword.ok, false);
  const bound = await bindUserPhone(prisma, user.id, password, phones.bound, "246801", { now });
  assert.equal(bound.ok, true);

  const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(after.phone, phones.bound);
  assert.deepEqual(after.roles, before.roles);
  assert.equal(after.organizationId, before.organizationId);
  assert.equal(await prisma.parentStudentLink.count({ where: { parentUserId: user.id, studentId: student.id } }), 1);
  assert.equal(await bcrypt.compare(password, after.passwordHash), true);

  const loggedIn = await verifyPhoneCode(prisma, phones.bound, "246801", { now: new Date(now.getTime() + 70 * 1000) });
  assert.equal(loggedIn.ok, false);
  const resent = await sendPhoneCode(prisma, phones.bound, { now: new Date(now.getTime() + 70 * 1000), randomCode: () => "111222" });
  assert.equal(resent.ok, true);
  const phoneLogin = await verifyPhoneCode(prisma, phones.bound, "111222", { now: new Date(now.getTime() + 70 * 1000) });
  assert.equal(phoneLogin.ok && phoneLogin.kind, "login");
  if (phoneLogin.ok && phoneLogin.kind === "login") {
    assert.equal(phoneLogin.user.id, user.id);
    assert.deepEqual(phoneLogin.user.roles, ["TEACHER", "PARENT"]);
    assert.equal(phoneLogin.user.organizationId, organization.id);
  }

  const passwordLogin = await post("/api/auth/login", { email: user.email, password });
  assert.equal(passwordLogin.status, 200);
  assert.equal(passwordLogin.json?.redirect, "/teacher");
});

test("a phone already owned by another account cannot be bound or merged", async () => {
  const organization = await prisma.organization.create({ data: { name: `占用测试 ${suffix}` } });
  orgIds.push(organization.id);
  const owner = await prisma.user.create({
    data: {
      organizationId: organization.id,
      email: `taken-${suffix}@edupilot.test`,
      passwordHash: await bcrypt.hash("taken-pass", 12),
      name: "已占用",
      roles: ["OWNER"],
      phone: phones.taken,
    },
  });
  const other = await prisma.user.create({
    data: {
      organizationId: organization.id,
      email: `other-${suffix}@edupilot.test`,
      passwordHash: await bcrypt.hash("other-pass", 12),
      name: "另一个账号",
      roles: ["TEACHER"],
    },
  });
  await sendPhoneCode(prisma, phones.taken, { now, randomCode: () => "333444" });
  const rejected = await bindUserPhone(prisma, other.id, "other-pass", phones.taken, "333444", { now });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.status, 409);
  const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
  assert.equal(unchanged.phone, phones.taken);
  assert.deepEqual(unchanged.roles, ["OWNER"]);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).phone, null);
});

test("request fields cannot grant owner or teacher access", async () => {
  const victim = await prisma.organization.create({ data: { name: `越权目标 ${suffix}` } });
  orgIds.push(victim.id);
  const parent = await prisma.user.create({
    data: {
      organizationId: victim.id,
      email: `plain-${suffix}@edupilot.test`,
      passwordHash: await bcrypt.hash("plain-pass", 12),
      name: "普通用户",
      roles: ["PARENT"],
    },
  });
  const deniedOrg = await post("/api/auth/phone/organization", {
    ticket: "forged",
    name: "伪造机构",
    role: "OWNER",
    organizationId: victim.id,
    roles: ["OWNER", "TEACHER"],
  });
  assert.equal(deniedOrg.status, 400);
  const deniedInvite = await post("/api/auth/phone/invite", {
    ticket: "forged",
    code: "TEACHER1",
    role: "TEACHER",
    organizationId: victim.id,
    studentId: "other-student",
  });
  assert.notEqual(deniedInvite.status, 200);
  const stillParent = await prisma.user.findUniqueOrThrow({ where: { id: parent.id } });
  assert.deepEqual(stillParent.roles, ["PARENT"]);
  assert.equal(stillParent.organizationId, victim.id);

  const ticket = await signupTicket(phones.owner, "新负责人", now);
  const created = await post("/api/auth/phone/organization", {
    ticket,
    name: `新机构 ${suffix}`,
    role: "TEACHER",
    organizationId: victim.id,
    roles: ["TEACHER"],
  });
  assert.equal(created.status, 200, created.json?.message);
  const createdUser = await prisma.user.findUniqueOrThrow({ where: { phone: phones.owner } });
  orgIds.push(createdUser.organizationId);
  assert.deepEqual(createdUser.roles, ["OWNER"]);
  assert.notEqual(createdUser.organizationId, victim.id);
  assert.equal(await prisma.user.count({ where: { id: parent.id, roles: { has: "OWNER" } } }), 0);
});

test("teacher and parent invites are single use and ignore caller-supplied targets", async () => {
  const home = await prisma.organization.create({ data: { name: `邀请机构 ${suffix}` } });
  const other = await prisma.organization.create({ data: { name: `其他机构 ${suffix}` } });
  orgIds.push(home.id, other.id);
  const owner = await prisma.user.create({
    data: {
      organizationId: home.id,
      email: `invite-owner-${suffix}@edupilot.test`,
      passwordHash: "unused",
      name: "邀请负责人",
      roles: ["OWNER"],
    },
  });
  const student = await prisma.student.create({ data: { organizationId: home.id, name: "指定孩子", studentNo: `P-${suffix}` } });
  const stranger = await prisma.student.create({ data: { organizationId: other.id, name: "其他孩子", studentNo: `X-${suffix}` } });
  const outsider = await prisma.user.create({
    data: {
      organizationId: other.id,
      email: `cross-${suffix}@edupilot.test`,
      passwordHash: "unused",
      name: "外机构",
      roles: ["TEACHER"],
      phone: phones.cross,
    },
  });

  const teacherTicket = await signupTicket(phones.teacher, "待加入教师", now);
  const missing = await redeemMembershipInvite(prisma, teacherTicket, "NOINVITE", { now });
  assert.equal(missing.ok, false);
  assert.equal(await prisma.user.count({ where: { phone: phones.teacher } }), 0);

  const teacherInvite = await createTeacherInvite(prisma, { id: owner.id, organizationId: owner.organizationId }, { now });
  assert.equal(teacherInvite.ok, true);
  const joined = await post("/api/auth/phone/invite", {
    ticket: teacherTicket,
    code: teacherInvite.code,
    role: "OWNER",
    organizationId: other.id,
    studentId: stranger.id,
  });
  assert.equal(joined.status, 200, joined.json?.message);
  const teacher = await prisma.user.findUniqueOrThrow({ where: { phone: phones.teacher } });
  assert.deepEqual(teacher.roles, ["TEACHER"]);
  assert.equal(teacher.organizationId, home.id);
  assert.equal(await prisma.teacher.count({ where: { userId: teacher.id, organizationId: home.id } }), 1);
  assert.equal(await prisma.parentStudentLink.count({ where: { parentUserId: teacher.id } }), 0);
  const reused = await redeemMembershipInvite(prisma, teacherTicket, teacherInvite.code ?? "", { now: new Date(now.getTime() + 3 * 60 * 1000) });
  assert.equal(reused.ok, false);

  const parentInvite = await createParentInvite(prisma, owner, student.id, { now });
  assert.equal(parentInvite.ok, true);
  const foreignParent = await createParentInvite(prisma, owner, stranger.id, { now });
  assert.equal(foreignParent.ok, false);
  const parentTicket = await signupTicket(phones.parent, "待加入家长", new Date(now.getTime() + 4 * 60 * 1000));
  const parentJoined = await redeemMembershipInvite(prisma, parentTicket, parentInvite.code ?? "", { now: new Date(now.getTime() + 4 * 60 * 1000) });
  assert.equal(parentJoined.ok, true);
  const parent = await prisma.user.findUniqueOrThrow({ where: { phone: phones.parent } });
  assert.deepEqual(parent.roles, ["PARENT"]);
  assert.equal(parent.organizationId, home.id);
  const links = await prisma.parentStudentLink.findMany({ where: { parentUserId: parent.id } });
  assert.deepEqual(links.map((link) => link.studentId), [student.id]);

  const expired = await createTeacherInvite(prisma, owner, { now });
  await prisma.membershipInvite.updateMany({
    where: { codeHash: { not: "" }, organizationId: home.id, consumedAt: null, kind: "TEACHER" },
    data: { expiresAt: new Date(now.getTime() - 1000) },
  });
  const expiredTicket = await issueActionTicket(prisma, phones.owner, now);
  const expiredResult = await redeemMembershipInvite(prisma, expiredTicket, expired.code ?? "", { now });
  assert.equal(expiredResult.ok, false);
  assert.match(expiredResult.ok ? "" : expiredResult.message, /过期/);

  const crossInvite = await createTeacherInvite(prisma, owner, { now: new Date(now.getTime() + 60 * 1000) });
  const crossTicket = await issueActionTicket(prisma, phones.cross, now);
  const crossResult = await redeemMembershipInvite(prisma, crossTicket, crossInvite.code ?? "", { now: new Date(now.getTime() + 60 * 1000) });
  assert.equal(crossResult.ok, false);
  assert.equal(crossResult.status, 403);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: outsider.id } })).organizationId, other.id);
  const stillOpen = await prisma.membershipInvite.findFirst({
    where: { organizationId: home.id, kind: "TEACHER", consumedAt: null, expiresAt: { gt: new Date(now.getTime() + 60 * 1000) } },
  });
  assert.ok(stillOpen);
});

test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});
