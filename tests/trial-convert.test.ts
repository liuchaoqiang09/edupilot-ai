import assert from "node:assert/strict";
import test from "node:test";
import { buildLessonAnalysisPrompt } from "../lib/ai-service.ts";
import { homeworkAssetFolder } from "../lib/homework-files.ts";
import { navigation } from "../lib/navigation.ts";
import { findCourseEnrollment } from "../lib/trial-convert.ts";
import { prisma } from "../lib/prisma.ts";

test("P3 已有报名可查到，避免教师转正重复建档依赖", async () => {
  const enrollment = await prisma.enrollment.findFirst({
    select: { organizationId: true, studentId: true, courseId: true, id: true },
  });
  if (!enrollment) return;
  const found = await findCourseEnrollment(prisma, {
    organizationId: enrollment.organizationId,
    studentId: enrollment.studentId,
    courseId: enrollment.courseId,
  });
  assert.ok(found);
  assert.equal(found.id, enrollment.id);
});

test("P5/P7 导航含出勤与考试；作业文件按机构分子目录；证据开关进 prompt", () => {
  const ownerNav = navigation("zh-CN", "owner").map((item) => item.href);
  assert.ok(ownerNav.includes("/owner/attendance"));
  assert.ok(ownerNav.includes("/owner/exams"));
  const teacherNav = navigation("zh-CN", "teacher").map((item) => item.href);
  assert.ok(teacherNav.includes("/teacher/homework"));
  assert.ok(teacherNav.includes("/teacher/exams"));
  assert.match(homeworkAssetFolder("org_demo_1"), /org_demo_1/);
  const withEvidence = buildLessonAnalysisPrompt({
    language: "zh-CN",
    useRecentSummaries: false,
    requireEvidence: true,
    history: [],
    lessonContent: "分数",
    studentPerformance: "专心",
    difficulties: "无",
    homework: "练习",
    studentNames: ["林子涵"],
  });
  assert.match(withEvidence.system, /追溯/);
});
