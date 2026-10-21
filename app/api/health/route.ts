import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "未知数据库错误";
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://***");
}

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { app: "ok", database: "error", message: "未配置 DATABASE_URL" },
      { status: 503 },
    );
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    const [organizations, users] = await Promise.all([
      prisma.organization.count(),
      prisma.user.count(),
    ]);

    return NextResponse.json({
      app: "ok",
      database: "ok",
      organizations,
      users,
    });
  } catch (error) {
    return NextResponse.json(
      { app: "ok", database: "error", message: safeMessage(error) },
      { status: 503 },
    );
  }
}
