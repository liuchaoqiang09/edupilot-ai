import { access, mkdir, writeFile, unlink } from "fs/promises";
import { join } from "path";

/** 生产部署须持久化这些相对目录（相对 process.cwd）。 */
export const PERSISTENT_UPLOAD_DIRS = ["uploads/homework-assets", "uploads/report-photos", "backups"] as const;

/** 启动与探活时确保持久目录存在且可写（含探活探针目录）。 */
export async function ensurePersistentDirs() {
  for (const relative of PERSISTENT_UPLOAD_DIRS) {
    await mkdir(join(process.cwd(), relative), { recursive: true });
  }
  await mkdir(join(process.cwd(), "uploads", ".health"), { recursive: true });
}

export async function assertUploadsWritable() {
  await ensurePersistentDirs();
  const root = join(process.cwd(), "uploads", ".health");
  const probe = join(root, `probe-${process.pid}.txt`);
  await writeFile(probe, "ok", "utf8");
  await access(probe);
  await unlink(probe).catch(() => undefined);
  return true;
}
