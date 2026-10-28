-- 消息列表按业务时间升降序；历史行先用 createdAt，应用启动后再用正文日期回填。
ALTER TABLE "edupilot"."ParentNotice" ADD COLUMN "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "edupilot"."ParentNotice" SET "occurredAt" = "createdAt";

CREATE INDEX "ParentNotice_organizationId_parentUserId_occurredAt_idx"
  ON "edupilot"."ParentNotice"("organizationId", "parentUserId", "occurredAt");
