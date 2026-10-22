import { PrismaClient } from "@prisma/client";
import { archiveLessonsOlderThan, retentionCutoff } from "../lib/lesson-archive.ts";

process.loadEnvFile(".env");

const dryRun = process.argv.includes("--dry-run");
if (!dryRun && process.env.ARCHIVE_CONFIRM !== "yes") {
  console.error("清理超过一年的课次前，请设置 ARCHIVE_CONFIRM=yes。先用 --dry-run 查看数量。");
  process.exit(1);
}

const prisma = new PrismaClient();
const cutoff = retentionCutoff();

try {
  const result = await archiveLessonsOlderThan(prisma, cutoff, "backups", dryRun);
  console.log(dryRun
    ? `早于 ${cutoff.toISOString()} 的课次有 ${result.exported} 节。本次只计数，没有写文件，也没有删除。`
    : `已导出 ${result.exported} 节，并在核对文件后清理 ${result.removed} 节。JSON：${result.jsonPath}`);
} finally {
  await prisma.$disconnect();
}
