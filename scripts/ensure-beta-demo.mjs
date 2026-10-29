/**
 * 内测专用：在空库或不含演示账号的库中写入一套演示机构（三账号同密）。
 * - 不调用 clearBusinessData，不会清空其他机构。
 * - 若三个演示邮箱已存在：默认只校验并退出成功；加 --reset-passwords 才重置密码。
 * - 生产可用，但必须显式确认：ALLOW_BETA_DEMO=yes
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DEMO_EMAILS, DEMO_PASSWORD, seedDemoOrganization } from "../prisma/seed.mjs";

process.loadEnvFile(".env");

const prisma = new PrismaClient();

function redact(message) {
  return String(message).replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://***");
}

async function main() {
  if (process.env.ALLOW_BETA_DEMO !== "yes") {
    console.error("拒绝执行：请设置环境变量 ALLOW_BETA_DEMO=yes 后再运行（内测一次性写演示数据）。");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("未配置 DATABASE_URL。");
    process.exit(1);
  }
  if (!process.env.AUTH_SECRET?.trim() || process.env.AUTH_SECRET.trim().length < 16) {
    console.error("AUTH_SECRET 未配置或过短（至少 16 字符）。");
    process.exit(1);
  }

  const resetPasswords = process.argv.includes("--reset-passwords");
  const existing = await prisma.user.findMany({
    where: { email: { in: [...DEMO_EMAILS] } },
    select: { email: true, organizationId: true, roles: true },
  });

  if (existing.length === DEMO_EMAILS.length) {
    const orgIds = new Set(existing.map((row) => row.organizationId));
    if (orgIds.size !== 1) {
      console.error("演示账号分散在多个机构，请人工检查，未做任何修改。");
      process.exit(1);
    }
    if (resetPasswords) {
      const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
      await prisma.user.updateMany({
        where: { email: { in: [...DEMO_EMAILS] } },
        data: { passwordHash },
      });
      console.log("已重置三个演示账号密码为统一内测密码。");
    } else {
      console.log("演示三账号已存在，无需写入。需要统一重置密码时加：--reset-passwords");
    }
    for (const email of DEMO_EMAILS) console.log(`  ${email}`);
    console.log("内测登录密码见 INTERNAL_BETA.md（与本地 seed 相同）。");
    return;
  }

  if (existing.length > 0) {
    console.error("只找到部分演示账号，状态不完整，请人工检查后再试。已找到：");
    for (const row of existing) console.error(`  ${row.email}`);
    process.exit(1);
  }

  await seedDemoOrganization(prisma);
  console.log("已写入内测演示机构与三端账号（未清空其他机构）。");
  for (const email of DEMO_EMAILS) console.log(`  ${email}`);
  console.log("密码与本地 seed 相同，见 INTERNAL_BETA.md。");
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entry) {
  main()
    .then(() => prisma.$disconnect())
    .catch(async (error) => {
      console.error(redact(error instanceof Error ? error.message : error));
      await prisma.$disconnect();
      process.exit(1);
    });
}
