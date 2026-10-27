-- 报名折扣率。已有报名保持为空，缴费状态仍按原来的记录。
ALTER TABLE "edupilot"."Enrollment" ADD COLUMN "discountPercent" DECIMAL(5,2);
