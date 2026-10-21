-- CreateEnum
CREATE TYPE "edupilot"."MemberStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "edupilot"."Student" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "studentNo" TEXT,
    "grade" TEXT,
    "contactNote" TEXT,
    "status" "edupilot"."MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "edupilot"."Teacher" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "contact" TEXT,
    "status" "edupilot"."MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Teacher_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Student_organizationId_idx" ON "edupilot"."Student"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Student_organizationId_studentNo_key" ON "edupilot"."Student"("organizationId", "studentNo");

-- CreateIndex
CREATE UNIQUE INDEX "Teacher_userId_key" ON "edupilot"."Teacher"("userId");

-- CreateIndex
CREATE INDEX "Teacher_organizationId_idx" ON "edupilot"."Teacher"("organizationId");

-- AddForeignKey
ALTER TABLE "edupilot"."Student" ADD CONSTRAINT "Student_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "edupilot"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."Teacher" ADD CONSTRAINT "Teacher_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "edupilot"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."Teacher" ADD CONSTRAINT "Teacher_userId_fkey" FOREIGN KEY ("userId") REFERENCES "edupilot"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
