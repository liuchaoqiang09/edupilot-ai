-- 报名可指向具体班级。已有报名的 classGroupId 留空，不改金额和学员。
ALTER TABLE "edupilot"."Enrollment" ADD COLUMN "classGroupId" TEXT;

CREATE INDEX "Enrollment_classGroupId_idx" ON "edupilot"."Enrollment"("classGroupId");

ALTER TABLE "edupilot"."Enrollment" ADD CONSTRAINT "Enrollment_classGroupId_fkey" FOREIGN KEY ("classGroupId") REFERENCES "edupilot"."ClassGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
