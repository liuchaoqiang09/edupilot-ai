CREATE TYPE "edupilot"."LessonRequestKind" AS ENUM ('RESCHEDULE', 'SUBSTITUTE');
CREATE TYPE "edupilot"."LessonRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TABLE "edupilot"."LessonChangeRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lessonSessionId" TEXT NOT NULL,
    "kind" "edupilot"."LessonRequestKind" NOT NULL,
    "status" "edupilot"."LessonRequestStatus" NOT NULL DEFAULT 'PENDING',
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "substituteTeacherId" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "requestedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "LessonChangeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LessonChangeRequest_organizationId_status_idx" ON "edupilot"."LessonChangeRequest"("organizationId", "status");
CREATE INDEX "LessonChangeRequest_lessonSessionId_idx" ON "edupilot"."LessonChangeRequest"("lessonSessionId");

ALTER TABLE "edupilot"."LessonChangeRequest" ADD CONSTRAINT "LessonChangeRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "edupilot"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "edupilot"."LessonChangeRequest" ADD CONSTRAINT "LessonChangeRequest_lessonSessionId_fkey" FOREIGN KEY ("lessonSessionId") REFERENCES "edupilot"."LessonSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "edupilot"."LessonChangeRequest" ADD CONSTRAINT "LessonChangeRequest_substituteTeacherId_fkey" FOREIGN KEY ("substituteTeacherId") REFERENCES "edupilot"."Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "edupilot"."LessonChangeRequest" ADD CONSTRAINT "LessonChangeRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "edupilot"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "edupilot"."LessonChangeRequest" ADD CONSTRAINT "LessonChangeRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "edupilot"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "edupilot"."ReportReply" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "parentUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportReply_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReportReply_reportId_parentUserId_key" ON "edupilot"."ReportReply"("reportId", "parentUserId");
CREATE INDEX "ReportReply_organizationId_idx" ON "edupilot"."ReportReply"("organizationId");

ALTER TABLE "edupilot"."ReportReply" ADD CONSTRAINT "ReportReply_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "edupilot"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "edupilot"."ReportReply" ADD CONSTRAINT "ReportReply_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "edupilot"."TeachingReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "edupilot"."ReportReply" ADD CONSTRAINT "ReportReply_parentUserId_fkey" FOREIGN KEY ("parentUserId") REFERENCES "edupilot"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
