-- AlterTable
ALTER TABLE "edupilot"."Teacher" ADD COLUMN "accountUserId" TEXT;

-- AlterTable
ALTER TABLE "edupilot"."MembershipInvite" ADD COLUMN "teacherId" TEXT;

-- Keep the login that is already linked, so the owner can unlink and link it again.
UPDATE "edupilot"."Teacher" SET "accountUserId" = "userId" WHERE "userId" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Teacher_accountUserId_key" ON "edupilot"."Teacher"("accountUserId");

-- AddForeignKey
ALTER TABLE "edupilot"."Teacher" ADD CONSTRAINT "Teacher_accountUserId_fkey" FOREIGN KEY ("accountUserId") REFERENCES "edupilot"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."MembershipInvite" ADD CONSTRAINT "MembershipInvite_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "edupilot"."Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
