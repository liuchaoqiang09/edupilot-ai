import { access, mkdir, writeFile, unlink } from "fs/promises";
import { join } from "path";

/** 生产部署须持久化这些相对目录（相对 process.cwd）。 */
export const PERSISTENT_UPLOAD_DIRS = ["uploads/homework-assets", "uploads/report-photos", "backups"] as const;

export async function assertUploadsWritable() {
  const root = join(process.cwd(), "uploads", ".health");
  await mkdir(root, { recursive: true });
  const probe = join(root, `probe-${process.pid}.txt`);
  await writeFile(probe, "ok", "utf8");
  await access(probe);
  await unlink(probe).catch(() => undefined);
  return true;
}
