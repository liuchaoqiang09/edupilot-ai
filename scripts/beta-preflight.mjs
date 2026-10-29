/**
 * 内测上线前预检：环境变量、数据库、持久目录、AI 配置（缺失只警告）。
 * 不改业务数据。退出码 0=可上线内测；1=阻塞项未过。
 */
import { access, constants, mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

process.loadEnvFile(".env");

const dirs = ["uploads/homework-assets", "uploads/report-photos", "backups", "uploads/.health"];

function redact(message) {
  return String(message).replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://***");
}

async function probeWritable(relative) {
  const root = join(process.cwd(), relative);
  await mkdir(root, { recursive: true });
  await access(root, constants.W_OK);
  if (relative === "uploads/.health") {
    const probe = join(root, `preflight-${process.pid}.txt`);
    await writeFile(probe, "ok", "utf8");
    await unlink(probe).catch(() => undefined);
  }
}

async function main() {
  const blocking = [];
  const warnings = [];

  const nodeEnv = process.env.NODE_ENV || "(unset)";
  console.log(`NODE_ENV=${nodeEnv}`);

  const secret = process.env.AUTH_SECRET?.trim() || "";
  if (!secret) blocking.push("缺少 AUTH_SECRET");
  else if (secret.length < 16) blocking.push("AUTH_SECRET 过短（至少 16 字符）");

  if (!process.env.DATABASE_URL?.trim()) blocking.push("缺少 DATABASE_URL");
  if (!process.env.APP_URL?.trim()) warnings.push("未设置 APP_URL（建议设为内测访问根地址，含 https）");

  if (nodeEnv === "production" && process.env.SEED_ENABLED === "true") {
    blocking.push("生产环境 SEED_ENABLED 必须为 false（禁止一键清库种子）");
  }

  if (process.env.AI_API_KEY?.trim() && process.env.AI_BASE_URL?.trim() && process.env.AI_MODEL?.trim()) {
    console.log("AI：已配置");
  } else {
    warnings.push("AI 未配齐（AI_API_KEY / AI_BASE_URL / AI_MODEL）。教学记录可写，报告生成与小星会失败。");
  }

  if ((process.env.SMS_PROVIDER || "unconfigured") !== "unconfigured" && nodeEnv === "production") {
    warnings.push("已设置 SMS_PROVIDER，但生产短信实现仍可能未接通；内测请继续用三演示账号邮箱登录。");
  }

  for (const dir of dirs) {
    try {
      await probeWritable(dir);
      console.log(`目录可写：${dir}`);
    } catch (error) {
      blocking.push(`目录不可写：${dir}（${redact(error instanceof Error ? error.message : error)}）`);
    }
  }

  if (process.env.DATABASE_URL?.trim()) {
    const prisma = new PrismaClient();
    try {
      await prisma.$queryRaw`SELECT 1`;
      console.log("数据库：可连接");

      const demoEmails = [
        "demo_owner@edupilot.test",
        "demo_teacher@edupilot.test",
        "demo_parent@edupilot.test",
      ];
      const found = await prisma.user.count({ where: { email: { in: demoEmails } } });
      if (found === 3) console.log("演示三账号：已就绪");
      else if (found === 0) warnings.push("演示三账号不存在。部署后执行：$env:ALLOW_BETA_DEMO='yes'; npm.cmd run beta:ensure-demo");
      else warnings.push(`演示账号不完整（找到 ${found}/3），请人工检查或重建。`);
    } catch (error) {
      blocking.push(`数据库不可用：${redact(error instanceof Error ? error.message : error)}`);
    } finally {
      await prisma.$disconnect().catch(() => undefined);
    }
  }

  if (warnings.length) {
    console.log("\n警告：");
    for (const item of warnings) console.log(`  - ${item}`);
  }
  if (blocking.length) {
    console.error("\n阻塞（必须修复后再内测上线）：");
    for (const item of blocking) console.error(`  - ${item}`);
    process.exit(1);
  }

  console.log("\n预检通过：可以按 INTERNAL_BETA.md 部署内测。");
}

main().catch((error) => {
  console.error(redact(error instanceof Error ? error.message : error));
  process.exit(1);
});
