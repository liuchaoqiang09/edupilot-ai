-- 一条请假只能安排一次补课（PostgreSQL UNIQUE 允许多个 NULL）
CREATE UNIQUE INDEX IF NOT EXISTS "LessonStudent_makeupSourceId_key" ON "edupilot"."LessonStudent"("makeupSourceId");
