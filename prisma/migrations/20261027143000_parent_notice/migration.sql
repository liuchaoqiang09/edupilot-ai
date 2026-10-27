CREATE TYPE "edupilot"."ParentNoticeKind" AS ENUM ('LESSON', 'HOMEWORK', 'REPORT', 'MAKEUP');

CREATE TABLE "edupilot"."ParentNotice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "parentUserId" TEXT NOT NULL,
    "kind" "edupilot"."ParentNoticeKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParentNotice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ParentNotice_parentUserId_dedupeKey_key" ON "edupilot"."ParentNotice"("parentUserId", "dedupeKey");
CREATE INDEX "ParentNotice_organizationId_parentUserId_readAt_idx" ON "edupilot"."ParentNotice"("organizationId", "parentUserId", "readAt");

ALTER TABLE "edupilot"."ParentNotice" ADD CONSTRAINT "ParentNotice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "edupilot"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "edupilot"."ParentNotice" ADD CONSTRAINT "ParentNotice_parentUserId_fkey" FOREIGN KEY ("parentUserId") REFERENCES "edupilot"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
