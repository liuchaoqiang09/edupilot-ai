-- CreateEnum
CREATE TYPE "edupilot"."ExamStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "edupilot"."ExamScoreMode" AS ENUM ('POINTS', 'GRADE', 'PASS_FAIL');

-- AlterEnum
ALTER TYPE "edupilot"."ParentNoticeKind" ADD VALUE 'EXAM';

-- CreateTable
CREATE TABLE "edupilot"."Exam" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "classGroupId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "examDate" TIMESTAMP(3) NOT NULL,
    "scoreMode" "edupilot"."ExamScoreMode" NOT NULL DEFAULT 'POINTS',
    "maxScore" DECIMAL(6,1),
    "classSummary" TEXT,
    "showAverage" BOOLEAN NOT NULL DEFAULT false,
    "status" "edupilot"."ExamStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "edupilot"."ExamResult" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "score" DECIMAL(6,1),
    "gradeLabel" TEXT,
    "absent" BOOLEAN NOT NULL DEFAULT false,
    "entered" BOOLEAN NOT NULL DEFAULT false,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "edupilot"."ExamRead" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "parentUserId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Exam_organizationId_status_idx" ON "edupilot"."Exam"("organizationId", "status");
CREATE INDEX "Exam_teacherId_examDate_idx" ON "edupilot"."Exam"("teacherId", "examDate");
CREATE INDEX "Exam_classGroupId_idx" ON "edupilot"."Exam"("classGroupId");
CREATE INDEX "ExamResult_organizationId_idx" ON "edupilot"."ExamResult"("organizationId");
CREATE INDEX "ExamResult_studentId_idx" ON "edupilot"."ExamResult"("studentId");
CREATE UNIQUE INDEX "ExamResult_examId_studentId_key" ON "edupilot"."ExamResult"("examId", "studentId");
CREATE INDEX "ExamRead_organizationId_idx" ON "edupilot"."ExamRead"("organizationId");
CREATE UNIQUE INDEX "ExamRead_examId_studentId_parentUserId_key" ON "edupilot"."ExamRead"("examId", "studentId", "parentUserId");

-- AddForeignKey
ALTER TABLE "edupilot"."Exam" ADD CONSTRAINT "Exam_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "edupilot"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "edupilot"."Exam" ADD CONSTRAINT "Exam_classGroupId_fkey" FOREIGN KEY ("classGroupId") REFERENCES "edupilot"."ClassGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "edupilot"."Exam" ADD CONSTRAINT "Exam_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "edupilot"."Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "edupilot"."Exam" ADD CONSTRAINT "Exam_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "edupilot"."Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "edupilot"."Exam" ADD CONSTRAINT "Exam_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "edupilot"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "edupilot"."ExamResult" ADD CONSTRAINT "ExamResult_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "edupilot"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "edupilot"."ExamResult" ADD CONSTRAINT "ExamResult_examId_fkey" FOREIGN KEY ("examId") REFERENCES "edupilot"."Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "edupilot"."ExamResult" ADD CONSTRAINT "ExamResult_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "edupilot"."Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "edupilot"."ExamRead" ADD CONSTRAINT "ExamRead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "edupilot"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "edupilot"."ExamRead" ADD CONSTRAINT "ExamRead_examId_fkey" FOREIGN KEY ("examId") REFERENCES "edupilot"."Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "edupilot"."ExamRead" ADD CONSTRAINT "ExamRead_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "edupilot"."Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "edupilot"."ExamRead" ADD CONSTRAINT "ExamRead_parentUserId_fkey" FOREIGN KEY ("parentUserId") REFERENCES "edupilot"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
