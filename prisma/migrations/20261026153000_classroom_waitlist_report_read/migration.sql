CREATE TABLE "edupilot"."Classroom" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "capacity" INTEGER NOT NULL,
  "available" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Classroom_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Classroom_organizationId_name_key" ON "edupilot"."Classroom"("organizationId", "name");
CREATE INDEX "Classroom_organizationId_idx" ON "edupilot"."Classroom"("organizationId");

ALTER TABLE "edupilot"."Classroom"
  ADD CONSTRAINT "Classroom_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "edupilot"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "edupilot"."LessonSession" ADD COLUMN "classroomId" TEXT;
CREATE INDEX "LessonSession_classroomId_idx" ON "edupilot"."LessonSession"("classroomId");
ALTER TABLE "edupilot"."LessonSession"
  ADD CONSTRAINT "LessonSession_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "edupilot"."Classroom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "edupilot"."ClassWaitlist" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "classGroupId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClassWaitlist_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClassWaitlist_studentId_classGroupId_key" ON "edupilot"."ClassWaitlist"("studentId", "classGroupId");
CREATE INDEX "ClassWaitlist_organizationId_classGroupId_idx" ON "edupilot"."ClassWaitlist"("organizationId", "classGroupId");

ALTER TABLE "edupilot"."ClassWaitlist"
  ADD CONSTRAINT "ClassWaitlist_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "edupilot"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "edupilot"."ClassWaitlist"
  ADD CONSTRAINT "ClassWaitlist_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "edupilot"."Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "edupilot"."ClassWaitlist"
  ADD CONSTRAINT "ClassWaitlist_classGroupId_fkey" FOREIGN KEY ("classGroupId") REFERENCES "edupilot"."ClassGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "edupilot"."ReportRead" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "parentUserId" TEXT NOT NULL,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReportRead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReportRead_reportId_parentUserId_key" ON "edupilot"."ReportRead"("reportId", "parentUserId");
CREATE INDEX "ReportRead_organizationId_idx" ON "edupilot"."ReportRead"("organizationId");

ALTER TABLE "edupilot"."ReportRead"
  ADD CONSTRAINT "ReportRead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "edupilot"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "edupilot"."ReportRead"
  ADD CONSTRAINT "ReportRead_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "edupilot"."TeachingReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "edupilot"."ReportRead"
  ADD CONSTRAINT "ReportRead_parentUserId_fkey" FOREIGN KEY ("parentUserId") REFERENCES "edupilot"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
