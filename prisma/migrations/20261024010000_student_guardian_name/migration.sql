-- 家长姓名单独保存。已有学生保持为空，不改报名和课时。
ALTER TABLE "edupilot"."Student" ADD COLUMN "guardianName" TEXT;
