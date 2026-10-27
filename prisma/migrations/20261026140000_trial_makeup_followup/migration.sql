CREATE TYPE "edupilot"."LessonSeat" AS ENUM ('ENROLLED', 'GUEST', 'TRIAL', 'CONVERTED');
CREATE TYPE "edupilot"."RenewalOutcome" AS ENUM ('TO_CONTACT', 'CONTACTED', 'NEXT_BOOKED', 'DECLINED', 'RENEWED');

ALTER TABLE "edupilot"."LessonStudent" ADD COLUMN "seat" "edupilot"."LessonSeat" NOT NULL DEFAULT 'ENROLLED';
ALTER TABLE "edupilot"."LessonStudent" ADD COLUMN "makeupSourceId" TEXT;

ALTER TABLE "edupilot"."LessonStudent"
  ADD CONSTRAINT "LessonStudent_makeupSourceId_fkey"
  FOREIGN KEY ("makeupSourceId") REFERENCES "edupilot"."LessonStudent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "LessonStudent_makeupSourceId_idx" ON "edupilot"."LessonStudent"("makeupSourceId");

CREATE TABLE "edupilot"."RenewalFollowUp" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "outcome" "edupilot"."RenewalOutcome" NOT NULL,
  "note" TEXT,
  "nextContactOn" DATE,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RenewalFollowUp_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RenewalFollowUp_organizationId_studentId_courseId_createdAt_idx"
  ON "edupilot"."RenewalFollowUp"("organizationId", "studentId", "courseId", "createdAt");

ALTER TABLE "edupilot"."RenewalFollowUp"
  ADD CONSTRAINT "RenewalFollowUp_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "edupilot"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "edupilot"."RenewalFollowUp"
  ADD CONSTRAINT "RenewalFollowUp_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "edupilot"."Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "edupilot"."RenewalFollowUp"
  ADD CONSTRAINT "RenewalFollowUp_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "edupilot"."Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "edupilot"."RenewalFollowUp"
  ADD CONSTRAINT "RenewalFollowUp_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "edupilot"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
