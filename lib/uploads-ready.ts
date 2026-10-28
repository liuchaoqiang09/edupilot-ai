import { access, constants, mkdir } from "fs/promises";
import { join } from "path";

/** 检查上传根目录可写；生产需把 uploads/ 挂到持久卷。 */
export async function ensureUploadsWritable() {
  const root = join(process.cwd(), "uploads");
  try {
    await mkdir(root, { recursive: true });
    await access(root, constants.W_OK);
    return { ok: true as const, path: root };
  } catch (error) {
    const message = error instanceof Error ? error.message : "uploads 目录不可写";
    return { ok: false as const, path: root, message };
  }
}
