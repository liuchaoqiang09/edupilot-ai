-- CreateTable
CREATE TABLE "edupilot"."MembershipInvite" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "studentId" TEXT,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MembershipInvite_codeHash_key" ON "edupilot"."MembershipInvite"("codeHash");

-- CreateIndex
CREATE INDEX "MembershipInvite_organizationId_idx" ON "edupilot"."MembershipInvite"("organizationId");

-- AddForeignKey
ALTER TABLE "edupilot"."MembershipInvite" ADD CONSTRAINT "MembershipInvite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "edupilot"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."MembershipInvite" ADD CONSTRAINT "MembershipInvite_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "edupilot"."Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."MembershipInvite" ADD CONSTRAINT "MembershipInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "edupilot"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
