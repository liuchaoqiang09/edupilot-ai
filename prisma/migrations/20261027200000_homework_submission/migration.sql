-- AlterTable
ALTER TABLE "edupilot"."TeachingRecord" ADD COLUMN "homeworkDueAt" TIMESTAMP(3);

-- CreateEnum
CREATE TYPE "edupilot"."HomeworkStatus" AS ENUM ('SUBMITTED', 'RETURNED', 'GRADED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "edupilot"."HomeworkAssetKind" AS ENUM ('IMAGE', 'FILE');

-- CreateTable
CREATE TABLE "edupilot"."HomeworkSubmission" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lessonSessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "status" "edupilot"."HomeworkStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submittedAt" TIMESTAMP(3),
    "submittedById" TEXT,
    "feedback" TEXT,
    "score" TEXT,
    "gradedAt" TIMESTAMP(3),
    "gradedByTeacherId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeworkSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "edupilot"."HomeworkAsset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "kind" "edupilot"."HomeworkAssetKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HomeworkAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HomeworkSubmission_organizationId_status_idx" ON "edupilot"."HomeworkSubmission"("organizationId", "status");

-- CreateIndex
CREATE INDEX "HomeworkSubmission_studentId_idx" ON "edupilot"."HomeworkSubmission"("studentId");

-- CreateIndex
CREATE INDEX "HomeworkSubmission_gradedByTeacherId_idx" ON "edupilot"."HomeworkSubmission"("gradedByTeacherId");

-- CreateIndex
CREATE UNIQUE INDEX "HomeworkSubmission_lessonSessionId_studentId_key" ON "edupilot"."HomeworkSubmission"("lessonSessionId", "studentId");

-- CreateIndex
CREATE INDEX "HomeworkAsset_organizationId_idx" ON "edupilot"."HomeworkAsset"("organizationId");

-- CreateIndex
CREATE INDEX "HomeworkAsset_submissionId_idx" ON "edupilot"."HomeworkAsset"("submissionId");

-- AddForeignKey
ALTER TABLE "edupilot"."HomeworkSubmission" ADD CONSTRAINT "HomeworkSubmission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "edupilot"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."HomeworkSubmission" ADD CONSTRAINT "HomeworkSubmission_lessonSessionId_fkey" FOREIGN KEY ("lessonSessionId") REFERENCES "edupilot"."LessonSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."HomeworkSubmission" ADD CONSTRAINT "HomeworkSubmission_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "edupilot"."Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."HomeworkSubmission" ADD CONSTRAINT "HomeworkSubmission_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "edupilot"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."HomeworkSubmission" ADD CONSTRAINT "HomeworkSubmission_gradedByTeacherId_fkey" FOREIGN KEY ("gradedByTeacherId") REFERENCES "edupilot"."Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."HomeworkAsset" ADD CONSTRAINT "HomeworkAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "edupilot"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."HomeworkAsset" ADD CONSTRAINT "HomeworkAsset_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "edupilot"."HomeworkSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
