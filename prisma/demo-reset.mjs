import { PrismaClient } from "@prisma/client";
import { seedDemoOrganization } from "./seed.mjs";

process.loadEnvFile(".env");

if (process.env.NODE_ENV === "production") {
  console.error("生产环境禁止重置演示数据。");
  process.exit(1);
}

const prisma = new PrismaClient();
const ownerEmail = "demo_owner@edupilot.test";
const demoEmails = [ownerEmail, "demo_teacher@edupilot.test", "demo_parent@edupilot.test"];

async function clearDemoOrganization(organizationId) {
  await prisma.$transaction(async (tx) => {
    const where = { organizationId };
    await tx.teachingReport.deleteMany({ where });
    await tx.teachingRecord.deleteMany({ where });
    await tx.lessonStudent.deleteMany({ where });
    await tx.courseHourBalance.deleteMany({ where });
    await tx.enrollment.deleteMany({ where });
    await tx.lessonSession.deleteMany({ where });
    await tx.membershipInvite.deleteMany({ where });
    await tx.parentStudentLink.deleteMany({ where });
    await tx.auditLog.deleteMany({ where });
    await tx.classGroup.deleteMany({ where });
    await tx.course.deleteMany({ where });
    await tx.teacher.deleteMany({ where });
    await tx.student.deleteMany({ where });
    await tx.user.deleteMany({ where });
    await tx.organization.delete({ where: { id: organizationId } });
  }, { timeout: 120000 });
}

async function main() {
  const accounts = await prisma.user.findMany({
    where: { email: { in: demoEmails } },
    select: { email: true, organizationId: true },
  });
  const owner = accounts.find((account) => account.email === ownerEmail);
  const outside = accounts.filter((account) => !owner || account.organizationId !== owner.organizationId);
  if (outside.length > 0) {
    throw new Error("演示账号出现在其他机构，已停止。没有删除任何数据。");
  }

  const before = await prisma.organization.findMany({ select: { id: true } });
  if (owner) {
    await clearDemoOrganization(owner.organizationId);
    console.log("已清理启明星素质成长中心的演示数据。");
  } else {
    console.log("还没有演示机构，直接生成初始数据。");
  }

  await seedDemoOrganization(prisma);

  const after = await prisma.organization.findMany({ select: { id: true } });
  const removed = before.filter((organization) => !after.some((item) => item.id === organization.id));
  const unexpected = removed.filter((organization) => organization.id !== owner?.organizationId);
  if (unexpected.length > 0) {
    throw new Error("重置时删到了其他机构，请检查数据库。");
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    const message = error instanceof Error ? error.message : "demo reset failed";
    console.error(message.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://***"));
    await prisma.$disconnect();
    process.exit(1);
  });
