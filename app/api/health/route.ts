import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertUploadsWritable } from "@/lib/upload-paths";

function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "未知数据库错误";
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://***");
}

/** 探活接口：应用、数据库、上传目录可写；不暴露租户规模。 */
export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { app: "ok", database: "error", uploads: "unknown", message: "未配置 DATABASE_URL" },
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

  const ok = database === "ok" && uploads === "ok";
  return NextResponse.json(
    {
      app: "ok",
      database,
      uploads,
      ...(databaseMessage ? { databaseMessage } : {}),
      ...(uploadsMessage ? { uploadsMessage } : {}),
    },
    { status: ok ? 200 : 503 },
  );
}
