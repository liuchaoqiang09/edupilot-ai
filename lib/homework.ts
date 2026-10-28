export type HomeworkStatusValue = "SUBMITTED" | "RETURNED" | "GRADED" | "COMPLETED";
export type HomeworkListStatus = "PENDING" | HomeworkStatusValue;

export const HOMEWORK_BODY_LIMIT = 2000;
export const HOMEWORK_FEEDBACK_LIMIT = 1000;
export const HOMEWORK_SCORE_LIMIT = 20;
export const HOMEWORK_MAX_IMAGES = 6;
export const HOMEWORK_MAX_FILES = 3;
export const HOMEWORK_MAX_IMAGE_BYTES = 2_000_000;
export const HOMEWORK_MAX_FILE_BYTES = 5_000_000;

export const homeworkStatusLabel: Record<HomeworkListStatus, string> = {
  PENDING: "未提交",
  SUBMITTED: "已提交",
  RETURNED: "已退回",
  GRADED: "已批改",
  COMPLETED: "已完成",
};

export const homeworkStatusTone: Record<HomeworkListStatus, string> = {
  PENDING: "bg-[#fff4e5] text-[#9a6729]",
  SUBMITTED: "bg-[#e8f3ff] text-[#2f5f8a]",
  RETURNED: "bg-[#fdecec] text-[#9a3434]",
  GRADED: "bg-[#eef6f1] text-[#34725d]",
  COMPLETED: "bg-[#eef6f1] text-[#34725d]",
};

export function listHomeworkStatus(status: HomeworkStatusValue | null | undefined): HomeworkListStatus {
  return status ?? "PENDING";
}

export function canParentEditSubmission(status: HomeworkStatusValue | null | undefined) {
  return status == null || status === "SUBMITTED" || status === "RETURNED";
}

export function isHomeworkLocked(status: HomeworkStatusValue | null | undefined) {
  return status === "GRADED" || status === "COMPLETED";
}

export function homeworkOverdue(dueAt: Date | null | undefined, status: HomeworkListStatus, now = new Date()) {
  if (!dueAt) return false;
  if (status === "GRADED" || status === "COMPLETED" || status === "SUBMITTED") return false;
  return dueAt.getTime() < now.getTime();
}

export function validateHomeworkBody(raw: string) {
  const body = raw.trim();
  if (body.length > HOMEWORK_BODY_LIMIT) return { ok: false as const, message: `说明最多 ${HOMEWORK_BODY_LIMIT} 字。` };
  return { ok: true as const, body };
}

export function validateFeedback(raw: string) {
  const feedback = raw.trim();
  if (feedback.length > HOMEWORK_FEEDBACK_LIMIT) return { ok: false as const, message: `评语最多 ${HOMEWORK_FEEDBACK_LIMIT} 字。` };
  return { ok: true as const, feedback: feedback || null };
}

export function validateScore(raw: string) {
  const score = raw.trim();
  if (score.length > HOMEWORK_SCORE_LIMIT) return { ok: false as const, message: `分数或等级最多 ${HOMEWORK_SCORE_LIMIT} 字。` };
  return { ok: true as const, score: score || null };
}

export function submissionHasContent(body: string, imageCount: number, fileCount: number) {
  return body.trim().length > 0 || imageCount > 0 || fileCount > 0;
}

/** 家长提交后教师可批改 / 退回 / 标完成；已完成也可退回重做。 */
export function canTeacherReview(status: HomeworkStatusValue | null | undefined) {
  return status === "SUBMITTED" || status === "GRADED" || status === "COMPLETED" || status === "RETURNED";
}
