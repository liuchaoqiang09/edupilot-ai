-- 教授课程与联系方式分开。contact 原有内容保持不动。
CREATE TABLE "edupilot"."TeacherCourse" (
    "teacherId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,

    CONSTRAINT "TeacherCourse_pkey" PRIMARY KEY ("teacherId","courseId")
);

CREATE INDEX "TeacherCourse_courseId_idx" ON "edupilot"."TeacherCourse"("courseId");

ALTER TABLE "edupilot"."TeacherCourse" ADD CONSTRAINT "TeacherCourse_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "edupilot"."Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "edupilot"."TeacherCourse" ADD CONSTRAINT "TeacherCourse_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "edupilot"."Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
