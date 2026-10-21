import type { Prisma, PrismaClient } from "@prisma/client";

type AuditClient = PrismaClient | Prisma.TransactionClient;

export async function writeAudit(
  db: AuditClient,
  input: {
    organizationId: string;
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    detail?: string;
  },
) {
  await db.auditLog.create({
    data: {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      detail: input.detail ?? null,
    },
  });
}
