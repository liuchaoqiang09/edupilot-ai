-- CreateEnum
CREATE TYPE "edupilot"."BillingType" AS ENUM ('PER_LESSON', 'PER_PERIOD');

-- AlterTable
ALTER TABLE "edupilot"."Course" ADD COLUMN "billingType" "edupilot"."BillingType" NOT NULL DEFAULT 'PER_LESSON';

-- AlterTable
ALTER TABLE "edupilot"."Enrollment" ADD COLUMN "startDate" DATE,
ADD COLUMN "endDate" DATE;
