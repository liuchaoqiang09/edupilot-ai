-- AlterTable
ALTER TABLE "edupilot"."Organization"
ADD COLUMN "businessTypes" "edupilot"."CourseCategory"[] NOT NULL DEFAULT ARRAY['ACADEMIC']::"edupilot"."CourseCategory"[],
ADD COLUMN "reportLanguage" TEXT NOT NULL DEFAULT 'zh-CN',
ADD COLUMN "aiUseRecentSummaries" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "aiRequireEvidence" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "aiTeacherMustConfirm" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "aiOwnerSpotCheck" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "edupilot"."AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "edupilot"."AuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "edupilot"."AuditLog"("actorId");

-- AddForeignKey
ALTER TABLE "edupilot"."AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "edupilot"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "edupilot"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
