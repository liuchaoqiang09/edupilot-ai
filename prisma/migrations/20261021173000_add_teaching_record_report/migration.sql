-- CreateEnum
CREATE TYPE "edupilot"."ReportStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'PUBLISHED', 'RETURNED');

-- CreateTable
CREATE TABLE "edupilot"."TeachingRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lessonSessionId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "lessonContent" TEXT NOT NULL DEFAULT '',
    "studentPerformance" TEXT NOT NULL DEFAULT '',
    "difficulties" TEXT NOT NULL DEFAULT '',
    "homework" TEXT,
    "teacherPrivateNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeachingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "edupilot"."TeachingReport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lessonSessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "teachingRecordId" TEXT NOT NULL,
    "status" "edupilot"."ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "summary" TEXT NOT NULL DEFAULT '',
    "strengths" TEXT NOT NULL DEFAULT '',
    "issues" TEXT NOT NULL DEFAULT '',
    "nextSteps" TEXT NOT NULL DEFAULT '',
    "homeworkSummary" TEXT,
    "aiModel" TEXT,
    "promptVersion" TEXT,
    "generatedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "revisionNote" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeachingReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeachingRecord_lessonSessionId_key" ON "edupilot"."TeachingRecord"("lessonSessionId");

-- CreateIndex
CREATE INDEX "TeachingRecord_organizationId_idx" ON "edupilot"."TeachingRecord"("organizationId");

-- CreateIndex
CREATE INDEX "TeachingRecord_teacherId_idx" ON "edupilot"."TeachingRecord"("teacherId");

-- CreateIndex
CREATE INDEX "TeachingReport_organizationId_status_idx" ON "edupilot"."TeachingReport"("organizationId", "status");

-- CreateIndex
CREATE INDEX "TeachingReport_studentId_idx" ON "edupilot"."TeachingReport"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "TeachingReport_lessonSessionId_studentId_key" ON "edupilot"."TeachingReport"("lessonSessionId", "studentId");

-- AddForeignKey
ALTER TABLE "edupilot"."TeachingRecord" ADD CONSTRAINT "TeachingRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "edupilot"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."TeachingRecord" ADD CONSTRAINT "TeachingRecord_lessonSessionId_fkey" FOREIGN KEY ("lessonSessionId") REFERENCES "edupilot"."LessonSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."TeachingRecord" ADD CONSTRAINT "TeachingRecord_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "edupilot"."Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."TeachingReport" ADD CONSTRAINT "TeachingReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "edupilot"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."TeachingReport" ADD CONSTRAINT "TeachingReport_lessonSessionId_fkey" FOREIGN KEY ("lessonSessionId") REFERENCES "edupilot"."LessonSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."TeachingReport" ADD CONSTRAINT "TeachingReport_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "edupilot"."Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."TeachingReport" ADD CONSTRAINT "TeachingReport_teachingRecordId_fkey" FOREIGN KEY ("teachingRecordId") REFERENCES "edupilot"."TeachingRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."TeachingReport" ADD CONSTRAINT "TeachingReport_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "edupilot"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."TeachingReport" ADD CONSTRAINT "TeachingReport_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "edupilot"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
