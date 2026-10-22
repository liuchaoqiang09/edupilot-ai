-- 学生停用原因。恢复在读时由应用清空。
ALTER TABLE "edupilot"."Student" ADD COLUMN "archiveReason" TEXT;
