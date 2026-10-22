import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

process.loadEnvFile(".env");

if (process.env.NODE_ENV === "production") {
  console.error("生产环境禁止重置演示账号密码。");
  process.exit(1);
}

const prisma = new PrismaClient();
const password = "edupilot2026";
const emails = ["demo_owner@edupilot.test", "demo_teacher@edupilot.test", "demo_parent@edupilot.test"];

try {
  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { email: true },
  });
  const found = new Set(existing.map((user) => user.email));
  const missing = emails.filter((email) => !found.has(email));
  if (missing.length > 0) {
    console.error(`找不到这些演示账号，没有修改任何密码：${missing.join(", ")}`);
    process.exitCode = 1;
  } else {
    const updated = await prisma.user.updateMany({
      where: { email: { in: emails } },
      data: { passwordHash },
    });
    if (updated.count !== emails.length) {
      console.error(`预期更新 ${emails.length} 个账号，实际更新 ${updated.count} 个。`);
      process.exitCode = 1;
    } else {
      console.log(`已把 ${emails.length} 个演示账号的密码重置为同一测试密码。账号未改，其他机构数据未动。`);
      for (const email of emails) console.log(email);
    }
  }
} finally {
  await prisma.$disconnect();
}
