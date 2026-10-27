-- 教师编号可选。已有教师保持为空，新增时也不强制填写。
ALTER TABLE "edupilot"."Teacher" ADD COLUMN "teacherNo" TEXT;

CREATE UNIQUE INDEX "Teacher_organizationId_teacherNo_key" ON "edupilot"."Teacher"("organizationId", "teacherNo");
