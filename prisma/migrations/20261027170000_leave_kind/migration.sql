CREATE TYPE "edupilot"."LeaveKind" AS ENUM ('PERSONAL', 'SICK');

ALTER TABLE "edupilot"."LessonStudent" ADD COLUMN "leaveKind" "edupilot"."LeaveKind";

UPDATE "edupilot"."LessonStudent"
SET "leaveKind" = 'PERSONAL'
WHERE "attendanceStatus" = 'LEAVE' AND "leaveKind" IS NULL;
