-- 课时调整记录，以及报名下的多笔收款。已有实收补成一笔「其他」收款，金额和缴费时间保持原样。
CREATE TYPE "edupilot"."PaymentMethod" AS ENUM ('CASH', 'WECHAT', 'ALIPAY', 'BANK', 'OTHER');

CREATE TABLE "edupilot"."HourAdjustment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "deltaHours" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HourAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "edupilot"."Payment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "method" "edupilot"."PaymentMethod" NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HourAdjustment_organizationId_createdAt_idx" ON "edupilot"."HourAdjustment"("organizationId", "createdAt");
CREATE INDEX "HourAdjustment_studentId_idx" ON "edupilot"."HourAdjustment"("studentId");
CREATE INDEX "Payment_organizationId_paidAt_idx" ON "edupilot"."Payment"("organizationId", "paidAt");
CREATE INDEX "Payment_enrollmentId_idx" ON "edupilot"."Payment"("enrollmentId");

ALTER TABLE "edupilot"."HourAdjustment" ADD CONSTRAINT "HourAdjustment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "edupilot"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "edupilot"."HourAdjustment" ADD CONSTRAINT "HourAdjustment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "edupilot"."Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "edupilot"."HourAdjustment" ADD CONSTRAINT "HourAdjustment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "edupilot"."Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "edupilot"."HourAdjustment" ADD CONSTRAINT "HourAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "edupilot"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "edupilot"."Payment" ADD CONSTRAINT "Payment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "edupilot"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "edupilot"."Payment" ADD CONSTRAINT "Payment_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "edupilot"."Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "edupilot"."Payment" ADD CONSTRAINT "Payment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "edupilot"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "edupilot"."Payment" (
    "id", "organizationId", "enrollmentId", "amount", "method", "paidAt", "createdById", "createdAt"
)
SELECT
    gen_random_uuid()::text,
    "organizationId",
    "id",
    "amount",
    'OTHER',
    COALESCE("paidAt", "createdAt"),
    "createdById",
    COALESCE("paidAt", "createdAt")
FROM "edupilot"."Enrollment"
WHERE "amount" > 0;
