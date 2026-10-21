-- CreateEnum
CREATE TYPE "edupilot"."LessonStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "edupilot"."AttendanceStatus" AS ENUM ('NOT_MARKED', 'PRESENT', 'ABSENT', 'LATE', 'LEAVE');

-- CreateTable
CREATE TABLE "edupilot"."LessonSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "classGroupId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "title" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "status" "edupilot"."LessonStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LessonSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "edupilot"."LessonStudent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lessonSessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "attendanceStatus" "edupilot"."AttendanceStatus" NOT NULL DEFAULT 'NOT_MARKED',
    "attendanceNote" TEXT,
    "lastAction" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LessonStudent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LessonSession_organizationId_startAt_idx" ON "edupilot"."LessonSession"("organizationId", "startAt");

-- CreateIndex
CREATE INDEX "LessonSession_teacherId_startAt_idx" ON "edupilot"."LessonSession"("teacherId", "startAt");

-- CreateIndex
CREATE INDEX "LessonSession_classGroupId_idx" ON "edupilot"."LessonSession"("classGroupId");

-- CreateIndex
CREATE INDEX "LessonStudent_organizationId_idx" ON "edupilot"."LessonStudent"("organizationId");

-- CreateIndex
CREATE INDEX "LessonStudent_studentId_idx" ON "edupilot"."LessonStudent"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "LessonStudent_lessonSessionId_studentId_key" ON "edupilot"."LessonStudent"("lessonSessionId", "studentId");

-- AddForeignKey
ALTER TABLE "edupilot"."LessonSession" ADD CONSTRAINT "LessonSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "edupilot"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."LessonSession" ADD CONSTRAINT "LessonSession_classGroupId_fkey" FOREIGN KEY ("classGroupId") REFERENCES "edupilot"."ClassGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."LessonSession" ADD CONSTRAINT "LessonSession_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "edupilot"."Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."LessonSession" ADD CONSTRAINT "LessonSession_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "edupilot"."Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."LessonSession" ADD CONSTRAINT "LessonSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "edupilot"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."LessonStudent" ADD CONSTRAINT "LessonStudent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "edupilot"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."LessonStudent" ADD CONSTRAINT "LessonStudent_lessonSessionId_fkey" FOREIGN KEY ("lessonSessionId") REFERENCES "edupilot"."LessonSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."LessonStudent" ADD CONSTRAINT "LessonStudent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "edupilot"."Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
