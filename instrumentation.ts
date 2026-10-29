/**
 * Next 启动时确保 uploads/backups 目录存在，避免首份作业/照片写入失败。
 * 不读取密钥，不做网络请求。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { ensurePersistentDirs } = await import("@/lib/upload-paths");
  const { opsLog } = await import("@/lib/ops-log");
  try {
    await ensurePersistentDirs();
    opsLog("info", "startup.uploads_ready");
  } catch (error) {
    opsLog("error", "startup.uploads_failed", {
      message: error instanceof Error ? error.message : "uploads init failed",
    });
  }
}
