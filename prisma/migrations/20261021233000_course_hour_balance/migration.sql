-- CreateTable
CREATE TABLE "edupilot"."CourseHourBalance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "remainingHours" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseHourBalance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourseHourBalance_studentId_courseId_key" ON "edupilot"."CourseHourBalance"("studentId", "courseId");

-- CreateIndex
CREATE INDEX "CourseHourBalance_organizationId_idx" ON "edupilot"."CourseHourBalance"("organizationId");

-- AddForeignKey
ALTER TABLE "edupilot"."CourseHourBalance" ADD CONSTRAINT "CourseHourBalance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "edupilot"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."CourseHourBalance" ADD CONSTRAINT "CourseHourBalance_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "edupilot"."Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edupilot"."CourseHourBalance" ADD CONSTRAINT "CourseHourBalance_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "edupilot"."Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill one balance per student and course from saved enrollments and already charged lessons.
-- Student.remainingHours is left untouched because it is not tied to a course.
INSERT INTO "edupilot"."CourseHourBalance" ("id", "organizationId", "studentId", "courseId", "remainingHours", "createdAt", "updatedAt")
SELECT
    md5('course-hour:' || pairs."studentId" || ':' || pairs."courseId"),
    pairs."organizationId",
    pairs."studentId",
    pairs."courseId",
    COALESCE(purchased.hours, 0) - COALESCE(charged.hours, 0),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT "organizationId", "studentId", "courseId" FROM "edupilot"."Enrollment"
    UNION
    SELECT lesson."organizationId", roster."studentId", lesson."courseId"
    FROM "edupilot"."LessonStudent" roster
    JOIN "edupilot"."LessonSession" lesson ON lesson."id" = roster."lessonSessionId"
    WHERE roster."hoursCharged" = true
) pairs
LEFT JOIN (
    SELECT "studentId", "courseId", SUM("hoursAdded")::integer AS hours
    FROM "edupilot"."Enrollment"
    GROUP BY "studentId", "courseId"
) purchased ON purchased."studentId" = pairs."studentId" AND purchased."courseId" = pairs."courseId"
LEFT JOIN (
    SELECT roster."studentId", lesson."courseId", COUNT(*)::integer AS hours
    FROM "edupilot"."LessonStudent" roster
    JOIN "edupilot"."LessonSession" lesson ON lesson."id" = roster."lessonSessionId"
    WHERE roster."hoursCharged" = true
    GROUP BY roster."studentId", lesson."courseId"
) charged ON charged."studentId" = pairs."studentId" AND charged."courseId" = pairs."courseId";
