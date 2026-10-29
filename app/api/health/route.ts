import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertUploadsWritable, PERSISTENT_UPLOAD_DIRS } from "@/lib/upload-paths";

function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "未知数据库错误";
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://***");
}

/** 探活接口：应用、数据库、上传目录可写；附带 AI/密钥是否已配置（不回传内容）。 */
export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      {
        app: "ok",
        database: "error",
        uploads: "unknown",
        authSecret: Boolean(process.env.AUTH_SECRET?.trim()),
        aiConfigured: false,
        message: "未配置 DATABASE_URL",
      },
      { status: 503 },
    );
  }

  let database: "ok" | "error" = "ok";
  let databaseMessage = "";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    database = "error";
    databaseMessage = safeMessage(error);
  }

  let uploads: "ok" | "error" = "ok";
  let uploadsMessage = "";
  try {
    await assertUploadsWritable();
  } catch (error) {
    uploads = "error";
    uploadsMessage = error instanceof Error ? error.message : "uploads 不可写";
  }

  const authSecret = Boolean(process.env.AUTH_SECRET?.trim()) && (process.env.AUTH_SECRET?.trim().length ?? 0) >= 16;
  const aiConfigured = Boolean(
    process.env.AI_API_KEY?.trim() && process.env.AI_BASE_URL?.trim() && process.env.AI_MODEL?.trim(),
  );

  const ok = database === "ok" && uploads === "ok" && authSecret;
  return NextResponse.json(
    {
      app: "ok",
      database,
      uploads,
      authSecret,
      aiConfigured,
      persistentDirs: PERSISTENT_UPLOAD_DIRS,
      ...(databaseMessage ? { databaseMessage } : {}),
      ...(uploadsMessage ? { uploadsMessage } : {}),
      ...(!authSecret ? { authSecretMessage: "AUTH_SECRET 未配置或过短" } : {}),
    },
    { status: ok ? 200 : 503 },
  );
}
