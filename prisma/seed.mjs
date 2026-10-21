import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

process.loadEnvFile(".env");

if (process.env.NODE_ENV === "production") {
  console.error("生产环境禁止运行种子脚本。");
  process.exit(1);
}

const prisma = new PrismaClient();
const organizationName = "青禾成长中心";
const accounts = [
  { email: "owner@edupilot.test", password: "owner-pass-2026", name: "周校长", role: "OWNER" },
  { email: "teacher@edupilot.test", password: "teacher-pass-2026", name: "王老师", role: "TEACHER" },
  { email: "parent@edupilot.test", password: "parent-pass-2026", name: "林子涵家长", role: "PARENT" },
];

async function main() {
  let organization = await prisma.organization.findFirst({ where: { name: organizationName } });
  if (!organization) {
    organization = await prisma.organization.create({
      data: {
        name: organizationName,
        timezone: process.env.DEFAULT_TIMEZONE || "Asia/Shanghai",
      },
    });
  }

  for (const account of accounts) {
    const passwordHash = await bcrypt.hash(account.password, 12);
    await prisma.user.upsert({
      where: { email: account.email },
      update: {
        name: account.name,
        passwordHash,
        roles: [account.role],
        organizationId: organization.id,
      },
      create: {
        email: account.email,
        name: account.name,
        passwordHash,
        roles: [account.role],
        organizationId: organization.id,
      },
    });
    console.log(`${account.role} ${account.email}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    const message = error instanceof Error ? error.message : "seed failed";
    console.error(message.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://***"));
    await prisma.$disconnect();
    process.exit(1);
  });
