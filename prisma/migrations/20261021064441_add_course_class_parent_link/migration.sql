-- CreateEnum
CREATE TYPE "edupilot"."CourseCategory" AS ENUM ('ACADEMIC', 'ART', 'EARLY_CHILDHOOD', 'OTHER');

-- CreateEnum
CREATE TYPE "edupilot"."ArchiveStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "edupilot"."Course" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "edupilot"."CourseCategory",
    "description" TEXT,
    "status" "edupilot"."ArchiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "edupilot"."ClassGroup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "capacity" INTEGER,
    "status" "edupilot"."ArchiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "edupilot"."ParentStudentLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "parentUserId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParentStudentLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Course_organizationId_idx" ON "edupilot"."Course"("organizationId");

-- CreateIndex
CREATE INDEX "ClassGroup_organizationId_idx" ON "edupilot"."ClassGroup"("organizationId");

-- CreateIndex
CREATE INDEX "ClassGroup_courseId_idx" ON "edupilot"."ClassGroup"("courseId");

-- CreateIndex
CREATE INDEX "ClassGroup_teacherId_idx" ON "edupilot"."ClassGroup"("teacherId");

-- CreateIndex
CREATE INDEX "ParentStudentLink_organizationId_idx" ON "edupilot"."ParentStudentLink"("organizationId");

-- CreateIndex
CREATE INDEX "ParentStudentLink_studentId_idx" ON "edupilot"."ParentStudentLink"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "ParentStudentLink_parentUserId_studentId_key" ON "edupilot"."ParentStudentLink"("parentUserId", "studentId");

-- AddForeignKey
ALTER TABLE "edupilot"."Course" ADD CONSTRAINT "Course_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "edupilot"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."ClassGroup" ADD CONSTRAINT "ClassGroup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "edupilot"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."ClassGroup" ADD CONSTRAINT "ClassGroup_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "edupilot"."Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."ClassGroup" ADD CONSTRAINT "ClassGroup_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "edupilot"."Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."ParentStudentLink" ADD CONSTRAINT "ParentStudentLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "edupilot"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."ParentStudentLink" ADD CONSTRAINT "ParentStudentLink_parentUserId_fkey" FOREIGN KEY ("parentUserId") REFERENCES "edupilot"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."ParentStudentLink" ADD CONSTRAINT "ParentStudentLink_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "edupilot"."Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
