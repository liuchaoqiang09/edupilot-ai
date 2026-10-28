/**
 * 作业提交/批改闭环（连真实库）。
 * 覆盖：布置 → 空提交失败 → 文字提交 → 越权批改失败 → 退回须评语 → 退回后可再交 → 批改通知 → 已批改不可改。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { reviewHomeworkForTeacher, submitHomeworkForParent } from "@/lib/homework-flow";
import { prisma } from "@/lib/prisma";

test("HW-SIM 家长提交与教师批改/退回闭环", async () => {
  const org = await prisma.organization.findFirst({ select: { id: true } });
  assert.ok(org);
  const seat = await prisma.lessonStudent.findFirst({
    where: {
      organizationId: org.id,
      lessonSession: { status: { not: "CANCELLED" }, teacher: { status: "ACTIVE", userId: { not: null } } },
      student: { status: "ACTIVE", parentLinks: { some: { organizationId: org.id } } },
    },
    select: {
      id: true,
      studentId: true,
      lessonSessionId: true,
      lessonSession: { select: { teacherId: true } },
      student: { select: { parentLinks: { where: { organizationId: org.id }, select: { parentUserId: true }, take: 1 } } },
    },
  });
  assert.ok(seat?.student.parentLinks[0], "需要有家长绑定的在册课次");
  const parentUserId = seat.student.parentLinks[0].parentUserId;
  const teacherId = seat.lessonSession.teacherId;

  // 确保本课有布置作业（测试临时写入，结束后可保留无害文案）
  await prisma.teachingRecord.upsert({
    where: { lessonSessionId: seat.lessonSessionId },
    create: {
      organizationId: org.id,
      lessonSessionId: seat.lessonSessionId,
      teacherId,
      lessonContent: "自动测教学记录",
      homework: "完成课本 P12 练习题，并拍照上传。",
    },
    update: { homework: "完成课本 P12 练习题，并拍照上传。" },
  });

  // 清理本测可能残留的提交
  await prisma.homeworkSubmission.deleteMany({
    where: { lessonSessionId: seat.lessonSessionId, studentId: seat.studentId },
  });

  const empty = await submitHomeworkForParent({
    organizationId: org.id,
    parentUserId,
    lessonStudentId: seat.id,
    bodyRaw: "   ",
    files: [],
  });
  assert.equal(empty.ok, false);

  const stranger = await prisma.user.findFirst({
    where: {
      organizationId: org.id,
      roles: { has: "PARENT" },
      id: { not: parentUserId },
      parentStudentLinks: { none: { studentId: seat.studentId } },
    },
    select: { id: true },
  });
  if (stranger) {
    const denied = await submitHomeworkForParent({
      organizationId: org.id,
      parentUserId: stranger.id,
      lessonStudentId: seat.id,
      bodyRaw: "越权提交",
    });
    assert.equal(denied.ok, false);
  }

  const submitted = await submitHomeworkForParent({
    organizationId: org.id,
    parentUserId,
    lessonStudentId: seat.id,
    bodyRaw: `自动测提交 ${Date.now()}`,
  });
  assert.equal(submitted.ok, true);

  const row = await prisma.homeworkSubmission.findUniqueOrThrow({
    where: { lessonSessionId_studentId: { lessonSessionId: seat.lessonSessionId, studentId: seat.studentId } },
  });
  assert.equal(row.status, "SUBMITTED");
  assert.equal(row.submittedById, parentUserId);

  const otherTeacher = await prisma.teacher.findFirst({
    where: { organizationId: org.id, status: "ACTIVE", id: { not: teacherId } },
    select: { id: true },
  });
  if (otherTeacher) {
    const hijack = await reviewHomeworkForTeacher({
      organizationId: org.id,
      teacherId: otherTeacher.id,
      submissionId: row.id,
      action: "grade",
      feedbackRaw: "冒充批改",
      scoreRaw: "A",
    });
    assert.equal(hijack.ok, false);
  }

  const returnNoReason = await reviewHomeworkForTeacher({
    organizationId: org.id,
    teacherId,
    submissionId: row.id,
    action: "return",
    feedbackRaw: "  ",
    scoreRaw: "",
  });
  assert.equal(returnNoReason.ok, false);

  const returned = await reviewHomeworkForTeacher({
    organizationId: org.id,
    teacherId,
    submissionId: row.id,
    action: "return",
    feedbackRaw: "请补全计算过程。",
    scoreRaw: "60",
  });
  assert.equal(returned.ok, true);
  const afterReturn = await prisma.homeworkSubmission.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(afterReturn.status, "RETURNED");
  assert.equal(afterReturn.score, null);
  assert.equal(afterReturn.feedback, "请补全计算过程。");

  const resubmit = await submitHomeworkForParent({
    organizationId: org.id,
    parentUserId,
    lessonStudentId: seat.id,
    bodyRaw: "已按评语补全计算过程。",
  });
  assert.equal(resubmit.ok, true);

  const graded = await reviewHomeworkForTeacher({
    organizationId: org.id,
    teacherId,
    submissionId: row.id,
    action: "grade",
    feedbackRaw: "这次完整了。",
    scoreRaw: "A",
  });
  assert.equal(graded.ok, true);
  const afterGrade = await prisma.homeworkSubmission.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(afterGrade.status, "GRADED");
  assert.equal(afterGrade.score, "A");

  const locked = await submitHomeworkForParent({
    organizationId: org.id,
    parentUserId,
    lessonStudentId: seat.id,
    bodyRaw: "想再改",
  });
  assert.equal(locked.ok, false);

  const completed = await reviewHomeworkForTeacher({
    organizationId: org.id,
    teacherId,
    submissionId: row.id,
    action: "complete",
    feedbackRaw: "收齐存档。",
    scoreRaw: "A",
  });
  assert.equal(completed.ok, true);
  assert.equal((await prisma.homeworkSubmission.findUniqueOrThrow({ where: { id: row.id } })).status, "COMPLETED");

  const notices = await prisma.parentNotice.findMany({
    where: { organizationId: org.id, kind: "HOMEWORK", dedupeKey: { startsWith: `homework-review:${row.id}:` } },
  });
  assert.ok(notices.length >= 3);
  assert.ok(notices.some((n) => n.title === "作业已退回"));
  assert.ok(notices.some((n) => n.title === "作业已批改"));
  assert.ok(notices.some((n) => n.title === "作业已完成"));
  assert.ok(notices.every((n) => n.href.includes(`/parent/homework/${seat.id}`)));

  await prisma.homeworkSubmission.delete({ where: { id: row.id } });
});
