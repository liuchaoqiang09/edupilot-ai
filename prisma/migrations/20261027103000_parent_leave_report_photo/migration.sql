ALTER TABLE "edupilot"."LessonStudent" ADD COLUMN "parentLeaveAt" TIMESTAMP(3),
ADD COLUMN "parentLeaveNote" TEXT;

CREATE TABLE "edupilot"."ReportPhoto" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportPhoto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReportPhoto_organizationId_idx" ON "edupilot"."ReportPhoto"("organizationId");
CREATE INDEX "ReportPhoto_reportId_idx" ON "edupilot"."ReportPhoto"("reportId");

ALTER TABLE "edupilot"."ReportPhoto" ADD CONSTRAINT "ReportPhoto_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "edupilot"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "edupilot"."ReportPhoto" ADD CONSTRAINT "ReportPhoto_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "edupilot"."TeachingReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
