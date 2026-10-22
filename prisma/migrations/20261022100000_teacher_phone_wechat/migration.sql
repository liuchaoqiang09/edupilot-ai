-- 把联系方式拆成手机号和微信号。只有恰好 11 位数字会写入 phone，课程名等文字直接丢弃。
ALTER TABLE "edupilot"."Teacher" ADD COLUMN "phone" TEXT;
ALTER TABLE "edupilot"."Teacher" ADD COLUMN "wechat" TEXT;

UPDATE "edupilot"."Teacher"
SET "phone" = regexp_replace("contact", '[^0-9]', '', 'g')
WHERE "contact" IS NOT NULL
  AND length(regexp_replace("contact", '[^0-9]', '', 'g')) = 11;

ALTER TABLE "edupilot"."Teacher" DROP COLUMN "contact";
