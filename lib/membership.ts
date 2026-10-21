import { createHmac, randomBytes, randomInt } from "crypto";
import bcrypt from "bcryptjs";
import { Prisma, PrismaClient } from "@prisma/client";
import { consumePhoneCode, openActionTicket } from "./phone-auth";

type Db = PrismaClient | Prisma.TransactionClient;

const inviteTtlMs = 7 * 24 * 60 * 60 * 1000;
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function pepper() {
  const value = process.env.AUTH_SECRET?.trim();
  if (!value) throw new Error("未配置 AUTH_SECRET");
  return value;
}

function hashInvite(code: string) {
  return createHmac("sha256", pepper()).update(`invite:${code}`).digest("hex");
}

function inviteCode() {
  return Array.from({ length: 8 }, () => alphabet[randomInt(0, alphabet.length)]).join("");
}

async function unusedPassword() {
  return bcrypt.hash(randomBytes(24).toString("hex"), 12);
}

export async function bindUserPhone(
  db: PrismaClient,
  userId: string,
  password: string,
  rawPhone: string,
  rawCode: string,
  options?: { now?: Date },
) {
  const now = options?.now ?? new Date();
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true, phone: true, organizationId: true, roles: true },
  });
  if (!user) return { ok: false as const, status: 401, message: "请先登录。" };
  if (user.phone) return { ok: false as const, status: 409, message: "这个账号已经绑定了手机号。" };
  const matched = await bcrypt.compare(password, user.passwordHash);
  if (!matched) return { ok: false as const, status: 401, message: "密码不正确。" };

  return db.$transaction(async (tx) => {
    const proof = await consumePhoneCode(tx, rawPhone, rawCode, now);
    if (!proof.ok) return proof;
    const taken = await tx.user.findUnique({ where: { phone: proof.phone }, select: { id: true } });
    if (taken) return { ok: false as const, status: 409, message: "这个手机号已经绑定了其他账号。" };
    const updated = await tx.user.updateMany({
      where: { id: user.id, phone: null, organizationId: user.organizationId },
      data: { phone: proof.phone },
    });
    if (updated.count !== 1) return { ok: false as const, status: 409, message: "手机号绑定没有完成。" };
    return { ok: true as const, status: 200, phone: proof.phone, message: "手机号已绑定。之后可以用验证码登录这个账号。" };
  });
}

export async function createTeacherInvite(
  db: Db,
  owner: { id: string; organizationId: string },
  options?: { now?: Date; teacherId?: string },
) {
  const now = options?.now ?? new Date();
  let teacherId: string | null = null;
  if (options?.teacherId) {
    const teacher = await db.teacher.findFirst({
      where: { id: options.teacherId, organizationId: owner.organizationId },
      select: { id: true, userId: true, accountUserId: true },
    });
    if (!teacher) return { ok: false as const, message: "找不到这位教师，或你无权为其他机构生成邀请码。" };
    if (teacher.userId || teacher.accountUserId) {
      return { ok: false as const, message: "这位老师已经有登录账号。在编辑里选择「关联账号」即可。" };
    }
    teacherId = teacher.id;
  }
  const code = inviteCode();
  await db.membershipInvite.create({
    data: {
      organizationId: owner.organizationId,
      kind: "TEACHER",
      codeHash: hashInvite(code),
      teacherId,
      createdById: owner.id,
      expiresAt: new Date(now.getTime() + inviteTtlMs),
      createdAt: now,
    },
  });
  return { ok: true as const, code, message: "教师邀请码已生成。对方注册后会自动关联这位老师，密码只有老师自己知道。" };
}

export async function createParentInvite(
  db: Db,
  owner: { id: string; organizationId: string },
  studentId: string,
  options?: { now?: Date },
) {
  const now = options?.now ?? new Date();
  const student = await db.student.findFirst({
    where: { id: studentId, organizationId: owner.organizationId },
    select: { id: true },
  });
  if (!student) return { ok: false as const, message: "找不到这名学生，或你无权为其他机构生成绑定码。" };
  const code = inviteCode();
  await db.membershipInvite.create({
    data: {
      organizationId: owner.organizationId,
      kind: "PARENT",
      codeHash: hashInvite(code),
      studentId: student.id,
      createdById: owner.id,
      expiresAt: new Date(now.getTime() + inviteTtlMs),
      createdAt: now,
    },
  });
  return { ok: true as const, code, message: "家长绑定码已生成。对方只能绑定这名学生。" };
}

async function accountFromSignup(
  tx: Prisma.TransactionClient,
  phone: string,
  organizationId: string,
  roles: Array<"OWNER" | "TEACHER" | "PARENT">,
) {
  const signup = await tx.phoneSignup.findUnique({ where: { phone } });
  if (!signup) return null;
  const user = await tx.user.create({
    data: {
      organizationId,
      email: `p${phone}@phone.edupilot.local`,
      phone,
      name: signup.name,
      roles,
      passwordHash: await unusedPassword(),
    },
    select: { id: true, organizationId: true, roles: true, name: true },
  });
  await tx.phoneSignup.delete({ where: { id: signup.id } });
  return user;
}

export async function createOrganizationForSignup(db: PrismaClient, rawTicket: string, rawName: string, options?: { now?: Date }) {
  const name = rawName.trim();
  if (name.length < 2 || name.length > 40) return { ok: false as const, status: 400, message: "机构名称需要 2 到 40 个字。" };
  const now = options?.now ?? new Date();
  try {
    return await db.$transaction(async (tx) => {
      const ticket = await openActionTicket(tx, rawTicket, now);
      if (!ticket.ok) return ticket;
      const existing = await tx.user.findUnique({ where: { phone: ticket.phone }, select: { id: true } });
      if (existing) return { ok: false as const, status: 409, message: "这个手机号已有账号，请直接登录。" };
      const signup = await tx.phoneSignup.findUnique({ where: { phone: ticket.phone }, select: { id: true } });
      if (!signup) return { ok: false as const, status: 400, message: "请先完成手机号登记。" };
      const consumed = await tx.phoneVerification.updateMany({ where: { id: ticket.id, consumedAt: null }, data: { consumedAt: now } });
      if (consumed.count !== 1) return { ok: false as const, status: 400, message: "凭证已失效，请重新验证手机号。" };
      const organization = await tx.organization.create({ data: { name } });
      const user = await accountFromSignup(tx, ticket.phone, organization.id, ["OWNER"]);
      if (!user) throw new Error("手机号登记缺失，已回滚。");
      return { ok: true as const, status: 200, user, message: "机构已创建，当前账号是该机构负责人。" };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false as const, status: 409, message: "这个手机号已有账号，请直接登录。" };
    }
    throw error;
  }
}

export async function redeemMembershipInvite(db: PrismaClient, rawTicket: string, rawCode: string, options?: { now?: Date }) {
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(code)) return { ok: false as const, status: 400, message: "邀请码不正确。" };
  const now = options?.now ?? new Date();
  const invite = await db.membershipInvite.findUnique({ where: { codeHash: hashInvite(code) } });
  if (!invite || invite.consumedAt) return { ok: false as const, status: 400, message: "邀请码不正确或已经使用。" };
  if (invite.expiresAt.getTime() <= now.getTime()) return { ok: false as const, status: 400, message: "邀请码已过期。" };
  if (invite.kind !== "TEACHER" && invite.kind !== "PARENT") return { ok: false as const, status: 400, message: "邀请码不正确。" };
  if (invite.kind === "PARENT" && !invite.studentId) return { ok: false as const, status: 400, message: "邀请码不正确。" };

  try {
    return await db.$transaction(async (tx) => {
      const ticket = await openActionTicket(tx, rawTicket, now);
      if (!ticket.ok) return ticket;
      const student = invite.studentId
        ? await tx.student.findFirst({ where: { id: invite.studentId, organizationId: invite.organizationId }, select: { id: true } })
        : null;
      if (invite.kind === "PARENT" && !student) return { ok: false as const, status: 400, message: "邀请码已失效。" };
      const current = await tx.user.findUnique({
        where: { phone: ticket.phone },
        select: { id: true, organizationId: true, roles: true, name: true },
      });
      if (current && current.organizationId !== invite.organizationId) {
        return { ok: false as const, status: 403, message: "这个手机号已经属于其他机构，不能加入。" };
      }
      if (!current) {
        const signup = await tx.phoneSignup.findUnique({ where: { phone: ticket.phone }, select: { id: true } });
        if (!signup) return { ok: false as const, status: 400, message: "请先完成手机号登记。" };
      }
      const consumedInvite = await tx.membershipInvite.updateMany({
        where: { id: invite.id, consumedAt: null, organizationId: invite.organizationId },
        data: { consumedAt: now },
      });
      if (consumedInvite.count !== 1) return { ok: false as const, status: 400, message: "邀请码不正确或已经使用。" };
      const consumedTicket = await tx.phoneVerification.updateMany({ where: { id: ticket.id, consumedAt: null }, data: { consumedAt: now } });
      if (consumedTicket.count !== 1) return { ok: false as const, status: 400, message: "凭证已失效，请重新验证手机号。" };

      if (invite.kind === "TEACHER") {
        const user = current ?? (await accountFromSignup(tx, ticket.phone, invite.organizationId, ["TEACHER"]));
        if (!user) throw new Error("手机号登记缺失，已回滚。");
        if (current && !current.roles.includes("TEACHER")) {
          await tx.user.update({ where: { id: current.id }, data: { roles: { set: [...current.roles, "TEACHER"] } } });
        }
        const reserved = await tx.teacher.findFirst({
          where: { organizationId: invite.organizationId, OR: [{ userId: user.id }, { accountUserId: user.id }] },
          select: { id: true },
        });
        if (invite.teacherId) {
          const teacher = await tx.teacher.findFirst({
            where: { id: invite.teacherId, organizationId: invite.organizationId },
            select: { id: true, userId: true, accountUserId: true },
          });
          if (!teacher || teacher.userId || teacher.accountUserId || (reserved && reserved.id !== teacher.id)) {
            return { ok: false as const, status: 400, message: "邀请码已失效。" };
          }
          await tx.teacher.update({
            where: { id: teacher.id },
            data: { userId: user.id, accountUserId: user.id },
          });
        } else if (!reserved) {
          await tx.teacher.create({
            data: { organizationId: invite.organizationId, name: user.name, userId: user.id, accountUserId: user.id },
          });
        }
        const saved = await tx.user.findUniqueOrThrow({
          where: { id: user.id },
          select: { id: true, organizationId: true, roles: true, name: true },
        });
        return { ok: true as const, status: 200, user: saved, message: "已加入机构并成为教师。" };
      }

      const user = current ?? (await accountFromSignup(tx, ticket.phone, invite.organizationId, ["PARENT"]));
      if (!user || !student) throw new Error("手机号登记缺失，已回滚。");
      if (current && !current.roles.includes("PARENT")) {
        await tx.user.update({ where: { id: current.id }, data: { roles: { set: [...current.roles, "PARENT"] } } });
      }
      await tx.parentStudentLink.create({
        data: { organizationId: invite.organizationId, parentUserId: user.id, studentId: student.id },
      });
      const saved = await tx.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { id: true, organizationId: true, roles: true, name: true },
      });
      return { ok: true as const, status: 200, user: saved, message: "已绑定孩子并成为家长。" };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false as const, status: 409, message: "这个关系已经存在。" };
    }
    throw error;
  }
}
