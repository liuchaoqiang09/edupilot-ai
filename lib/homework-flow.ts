import { revalidatePath } from "next/cache";
import {
  canParentEditSubmission,
  canTeacherReview,
  submissionHasContent,
  validateFeedback,
  validateHomeworkBody,
  validateScore,
  type HomeworkStatusValue,
} from "@/lib/homework";
import { removeHomeworkAssetFile, writeHomeworkAssetFiles } from "@/lib/homework-files";
import { formatDateTime } from "@/lib/datetime";
import { notifyLinkedParents } from "@/lib/parent-notice";
import { parentVisibleLessonFilter } from "@/lib/parent-scope";
import { prisma } from "@/lib/prisma";

function refreshParentTeacher(lessonStudentId?: string, lessonSessionId?: string) {
  revalidatePath("/parent/homework");
  revalidatePath("/teacher/homework");
  revalidatePath("/teacher");
  if (lessonStudentId) revalidatePath(`/parent/homework/${lessonStudentId}`);
  if (lessonSessionId) revalidatePath(`/teacher/homework/${lessonSessionId}`);
}

export async function findParentHomeworkSeat(input: {
  lessonStudentId: string;
  parentUserId: string;
  organizationId: string;
}) {
  return prisma.lessonStudent.findFirst({
    where: {
      id: input.lessonStudentId,
      organizationId: input.organizationId,
      ...parentVisibleLessonFilter(),
      student: { parentLinks: { some: { parentUserId: input.parentUserId, organizationId: input.organizationId } } },
      lessonSession: {
        status: { not: "CANCELLED" },
        teachingRecord: { is: { homework: { not: "" } } },
      },
    },
    select: {
      id: true,
      studentId: true,
      lessonSessionId: true,
      lessonSession: {
        select: {
          id: true,
          teacherId: true,
          title: true,
          startAt: true,
          course: { select: { name: true } },
          teachingRecord: { select: { homework: true, homeworkDueAt: true } },
        },
      },
      student: { select: { name: true } },
    },
  });
}

export async function submitHomeworkForParent(input: {
  organizationId: string;
  parentUserId: string;
  lessonStudentId: string;
  bodyRaw: string;
  removeAssetIds?: string[];
  files?: File[];
}) {
  const seat = await findParentHomeworkSeat({
    lessonStudentId: input.lessonStudentId,
    parentUserId: input.parentUserId,
    organizationId: input.organizationId,
  });
  if (!seat) return { ok: false as const, message: "找不到这份作业，或你没有权限。" };

  const bodyCheck = validateHomeworkBody(input.bodyRaw);
  if (!bodyCheck.ok) return bodyCheck;

  const existing = await prisma.homeworkSubmission.findUnique({
    where: { lessonSessionId_studentId: { lessonSessionId: seat.lessonSessionId, studentId: seat.studentId } },
    include: { assets: { select: { id: true, kind: true, contentType: true } } },
  });
  if (existing && !canParentEditSubmission(existing.status)) {
    return { ok: false as const, message: "教师已批改或标记完成，不能再改。若需修改请等教师退回。" };
  }

  const removeIds = (input.removeAssetIds ?? []).filter(Boolean);
  const keepAssets = (existing?.assets ?? []).filter((asset) => !removeIds.includes(asset.id));
  const incoming = (input.files ?? []).filter((item) => item instanceof File && item.size > 0);

  const written = await writeHomeworkAssetFiles(input.organizationId, existing?.id ?? "pending", incoming, {
    images: keepAssets.filter((asset) => asset.kind === "IMAGE").length,
    files: keepAssets.filter((asset) => asset.kind === "FILE").length,
  });
  if (!written.ok) {
    for (const asset of written.created) await removeHomeworkAssetFile(asset.id, asset.contentType);
    return { ok: false as const, message: written.message };
  }

  if (!submissionHasContent(bodyCheck.body, written.images, written.files)) {
    for (const asset of written.created) await removeHomeworkAssetFile(asset.id, asset.contentType);
    return { ok: false as const, message: "请至少填写说明、拍一张照片，或上传一个附件。" };
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const row = await tx.homeworkSubmission.upsert({
      where: { lessonSessionId_studentId: { lessonSessionId: seat.lessonSessionId, studentId: seat.studentId } },
      create: {
        organizationId: input.organizationId,
        lessonSessionId: seat.lessonSessionId,
        studentId: seat.studentId,
        body: bodyCheck.body,
        status: "SUBMITTED",
        submittedAt: now,
        submittedById: input.parentUserId,
        feedback: null,
        score: null,
        gradedAt: null,
        gradedByTeacherId: null,
      },
      update: {
        body: bodyCheck.body,
        status: "SUBMITTED",
        submittedAt: now,
        submittedById: input.parentUserId,
        feedback: null,
        score: null,
        gradedAt: null,
        gradedByTeacherId: null,
      },
    });
    if (removeIds.length > 0) {
      await tx.homeworkAsset.deleteMany({
        where: { submissionId: row.id, organizationId: input.organizationId, id: { in: removeIds } },
      });
    }
    if (written.created.length > 0) {
      await tx.homeworkAsset.createMany({
        data: written.created.map((asset) => ({
          id: asset.id,
          organizationId: input.organizationId,
          submissionId: row.id,
          kind: asset.kind,
          fileName: asset.fileName,
          contentType: asset.contentType,
          sizeBytes: asset.sizeBytes,
        })),
      });
    }
  });

  for (const asset of existing?.assets ?? []) {
    if (removeIds.includes(asset.id)) await removeHomeworkAssetFile(asset.id, asset.contentType);
  }

  refreshParentTeacher(input.lessonStudentId);
  return {
    ok: true as const,
    message: existing?.status === "RETURNED" ? "已重新提交，等待教师批改。" : "作业已提交。",
  };
}

export async function reviewHomeworkForTeacher(input: {
  organizationId: string;
  teacherId: string;
  submissionId: string;
  action: "grade" | "complete" | "return";
  feedbackRaw: string;
  scoreRaw: string;
}) {
  const feedbackCheck = validateFeedback(input.feedbackRaw);
  if (!feedbackCheck.ok) return feedbackCheck;
  const scoreCheck = validateScore(input.scoreRaw);
  if (!scoreCheck.ok) return scoreCheck;

  const submission = await prisma.homeworkSubmission.findFirst({
    where: {
      id: input.submissionId,
      organizationId: input.organizationId,
      lessonSession: { teacherId: input.teacherId, status: { not: "CANCELLED" } },
    },
    select: {
      id: true,
      status: true,
      studentId: true,
      lessonSessionId: true,
      lessonSession: { select: { id: true, title: true, startAt: true, course: { select: { name: true } } } },
      student: { select: { name: true } },
    },
  });
  if (!submission) return { ok: false as const, message: "找不到这份提交，或你不是授课教师。" };
  if (!canTeacherReview(submission.status)) return { ok: false as const, message: "当前状态不能批改。" };

  let status: Extract<HomeworkStatusValue, "GRADED" | "COMPLETED" | "RETURNED"> = "GRADED";
  let message = "已批改并通知家长。";
  if (input.action === "complete") {
    status = "COMPLETED";
    message = "已标记完成并通知家长。";
  } else if (input.action === "return") {
    status = "RETURNED";
    message = "已退回，家长可以重新提交。";
    if (!feedbackCheck.feedback) return { ok: false as const, message: "退回时请填写原因或修改建议。" };
  } else if (input.action !== "grade") {
    return { ok: false as const, message: "未知操作。" };
  }

  const now = new Date();
  await prisma.homeworkSubmission.update({
    where: { id: submission.id },
    data: {
      status,
      feedback: feedbackCheck.feedback,
      score: status === "RETURNED" ? null : scoreCheck.score,
      gradedAt: now,
      gradedByTeacherId: input.teacherId,
    },
  });

  const lessonName = submission.lessonSession.title?.trim() || submission.lessonSession.course.name;
  const when = formatDateTime(submission.lessonSession.startAt);
  const seat = await prisma.lessonStudent.findFirst({
    where: {
      lessonSessionId: submission.lessonSessionId,
      studentId: submission.studentId,
      organizationId: input.organizationId,
    },
    select: { id: true },
  });
  const href = seat ? `/parent/homework/${seat.id}` : "/parent/homework";
  await notifyLinkedParents({
    organizationId: input.organizationId,
    studentIds: [submission.studentId],
    kind: "HOMEWORK",
    title: status === "RETURNED" ? "作业已退回" : status === "COMPLETED" ? "作业已完成" : "作业已批改",
    body:
      status === "RETURNED"
        ? `${when}「${lessonName}」的作业需要重做`
        : `${when}「${lessonName}」的作业已${status === "COMPLETED" ? "完成" : "批改"}`,
    href,
    dedupeKey: `homework-review:${submission.id}:${status}:${now.toISOString()}`,
  });

  refreshParentTeacher(seat?.id, submission.lessonSessionId);
  return { ok: true as const, message };
}
