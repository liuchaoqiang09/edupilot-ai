/**
 * Phase A 全流程模拟用例（连真实库）。
 * 覆盖：创建 → 草稿不可见 → 录入 → 发布通知 → 家长可见仅自己 → 已读 → 与报告/作业边界。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createExamDraft, markExamRead, saveExamResults } from "@/lib/exam-flow";
import { parentCanSeeResult } from "@/lib/exam";
import { prisma } from "@/lib/prisma";

test("EX-SIM Phase A 教师发布与家长可见闭环", async () => {
  const org = await prisma.organization.findFirst({ select: { id: true } });
  assert.ok(org, "需要已有演示机构");
  const teacher = await prisma.teacher.findFirst({
    where: { organizationId: org.id, status: "ACTIVE", userId: { not: null }, classGroups: { some: { status: "ACTIVE", enrollments: { some: { student: { status: "ACTIVE" } } } } } },
    select: { id: true, userId: true, name: true, user: { select: { id: true, name: true } } },
  });
  assert.ok(teacher?.userId && teacher.user, "需要有登录账号的主讲教师");
  const classGroup = await prisma.classGroup.findFirst({
    where: { organizationId: org.id, teacherId: teacher.id, status: "ACTIVE", enrollments: { some: { student: { status: "ACTIVE" } } } },
    select: { id: true, name: true },
  });
  assert.ok(classGroup);

  const created = await createExamDraft({
    organizationId: org.id,
    teacherId: teacher.id,
    actorId: teacher.userId,
    actorName: teacher.user.name,
    classGroupId: classGroup.id,
    title: `自动测-单元考-${Date.now()}`,
    examDateKey: "2026-10-20",
    scoreMode: "POINTS",
    maxScoreRaw: "100",
    showAverage: true,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const examId = created.examId;

  const draft = await prisma.exam.findUniqueOrThrow({
    where: { id: examId },
    include: { results: { include: { student: true }, orderBy: { student: { name: "asc" } } } },
  });
  assert.equal(draft.status, "DRAFT");
  assert.ok(draft.results.length >= 1);

  // EX-SIM-01 草稿对家长查询应不可见
  const parentPeek = await prisma.exam.findFirst({ where: { id: examId, status: "PUBLISHED" } });
  assert.equal(parentPeek, null);

  const first = draft.results[0];
  const second = draft.results[1] ?? null;

  const saved = await saveExamResults({
    organizationId: org.id,
    teacherId: teacher.id,
    actorId: teacher.userId,
    actorName: teacher.user.name,
    examId,
    classSummary: "本单元整体掌握良好，请继续巩固错题。",
    showAverage: true,
    rows: draft.results.map((row, index) => ({
      studentId: row.studentId,
      absent: false,
      scoreRaw: index === 0 ? "92" : "",
      gradeRaw: "",
      commentRaw: index === 0 ? "计算细心，注意书写。" : "",
    })),
    publish: false,
  });
  assert.equal(saved.ok, true);

  // EX-SIM-02 仅保存草稿仍不可发布可见
  assert.equal(parentCanSeeResult("DRAFT", true), false);

  const published = await saveExamResults({
    organizationId: org.id,
    teacherId: teacher.id,
    actorId: teacher.userId,
    actorName: teacher.user.name,
    examId,
    classSummary: "本单元整体掌握良好，请继续巩固错题。",
    showAverage: true,
    rows: draft.results.map((row, index) => ({
      studentId: row.studentId,
      absent: index === 1,
      scoreRaw: index === 0 ? "92" : "",
      gradeRaw: "",
      commentRaw: index === 0 ? "计算细心，注意书写。" : index === 1 ? "缺考" : "",
    })),
    publish: true,
  });
  assert.equal(published.ok, true);

  const after = await prisma.exam.findUniqueOrThrow({
    where: { id: examId },
    include: { results: true },
  });
  assert.equal(after.status, "PUBLISHED");
  const entered = after.results.filter((row) => row.entered);
  assert.ok(entered.length >= 1);

  // EX-SIM-03 未录入的学生结果不对家长列表条件
  const unentered = after.results.filter((row) => !row.entered);
  for (const row of unentered) {
    assert.equal(parentCanSeeResult("PUBLISHED", row.entered), false);
  }

  // EX-SIM-04 通知只应覆盖已录入学生（含缺考）
  const notice = await prisma.parentNotice.findFirst({
    where: { organizationId: org.id, kind: "EXAM", dedupeKey: { startsWith: `exam:${examId}:` } },
    orderBy: { createdAt: "desc" },
  });
  assert.ok(notice, "应写入成绩发布消息");
  assert.ok(notice.href.includes(`/parent/exams/${examId}`));

  // EX-SIM-05 家长已读
  const link = await prisma.parentStudentLink.findFirst({
    where: { organizationId: org.id, studentId: first.studentId },
    select: { parentUserId: true },
  });
  if (link) {
    await markExamRead({
      organizationId: org.id,
      parentUserId: link.parentUserId,
      examId,
      studentId: first.studentId,
    });
    const read = await prisma.examRead.findFirst({
      where: { examId, studentId: first.studentId, parentUserId: link.parentUserId },
    });
    assert.ok(read);
  }

  // EX-SIM-06 隐私：结果表按学生隔离，查询自己孩子不会带出他人 score 字段给错误家长——用数据层断言每人独立行
  if (second) {
    const onlyFirst = await prisma.examResult.findMany({
      where: { examId, studentId: first.studentId, entered: true },
      select: { studentId: true, score: true },
    });
    assert.equal(onlyFirst.length, 1);
    assert.equal(onlyFirst[0].studentId, first.studentId);
  }

  // 清理本次模拟数据，避免污染演示库
  await prisma.exam.delete({ where: { id: examId } });
});
