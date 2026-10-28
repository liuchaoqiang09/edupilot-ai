export type ExamStatusValue = "DRAFT" | "PUBLISHED";
export type ExamScoreModeValue = "POINTS" | "GRADE" | "PASS_FAIL";

export const EXAM_TITLE_LIMIT = 80;
export const EXAM_COMMENT_LIMIT = 1000;
export const EXAM_SUMMARY_LIMIT = 2000;
export const EXAM_GRADE_LIMIT = 20;

export const examStatusLabel: Record<ExamStatusValue, string> = {
  DRAFT: "草稿",
  PUBLISHED: "已发布",
};

export const examScoreModeLabel: Record<ExamScoreModeValue, string> = {
  POINTS: "分数",
  GRADE: "等级",
  PASS_FAIL: "合格制",
};

export function parseExamDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00+08:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function validateExamTitle(raw: string) {
  const title = raw.trim();
  if (!title) return { ok: false as const, message: "请填写考试名称。" };
  if (title.length > EXAM_TITLE_LIMIT) return { ok: false as const, message: `考试名称最多 ${EXAM_TITLE_LIMIT} 字。` };
  return { ok: true as const, title };
}

export function validateClassSummary(raw: string) {
  const classSummary = raw.trim();
  if (classSummary.length > EXAM_SUMMARY_LIMIT) return { ok: false as const, message: `班级总结最多 ${EXAM_SUMMARY_LIMIT} 字。` };
  return { ok: true as const, classSummary: classSummary || null };
}

export function validateComment(raw: string) {
  const comment = raw.trim();
  if (comment.length > EXAM_COMMENT_LIMIT) return { ok: false as const, message: `个人评语最多 ${EXAM_COMMENT_LIMIT} 字。` };
  return { ok: true as const, comment: comment || null };
}

export function parseScoreMode(raw: string): ExamScoreModeValue | null {
  if (raw === "POINTS" || raw === "GRADE" || raw === "PASS_FAIL") return raw;
  return null;
}

/** 解析一行成绩。缺考优先；分数模式校验满分；等级/合格制用 gradeLabel。 */
export function parseExamResultInput(input: {
  mode: ExamScoreModeValue;
  maxScore: number | null;
  absent: boolean;
  scoreRaw: string;
  gradeRaw: string;
  commentRaw: string;
}) {
  const commentCheck = validateComment(input.commentRaw);
  if (!commentCheck.ok) return commentCheck;

  if (input.absent) {
    return {
      ok: true as const,
      entered: true,
      absent: true,
      score: null as number | null,
      gradeLabel: null as string | null,
      comment: commentCheck.comment,
    };
  }

  if (input.mode === "POINTS") {
    const text = input.scoreRaw.trim();
    if (!text) {
      return { ok: true as const, entered: false, absent: false, score: null, gradeLabel: null, comment: commentCheck.comment };
    }
    const score = Number(text);
    if (!Number.isFinite(score)) return { ok: false as const, message: "分数必须是数字。" };
    if (score < 0) return { ok: false as const, message: "分数不能小于 0。" };
    if (input.maxScore != null && score > input.maxScore) return { ok: false as const, message: `分数不能超过满分 ${input.maxScore}。` };
    return { ok: true as const, entered: true, absent: false, score, gradeLabel: null, comment: commentCheck.comment };
  }

  const gradeLabel = input.gradeRaw.trim();
  if (!gradeLabel) {
    return { ok: true as const, entered: false, absent: false, score: null, gradeLabel: null, comment: commentCheck.comment };
  }
  if (gradeLabel.length > EXAM_GRADE_LIMIT) return { ok: false as const, message: `等级最多 ${EXAM_GRADE_LIMIT} 字。` };
  if (input.mode === "PASS_FAIL" && gradeLabel !== "合格" && gradeLabel !== "不合格") {
    return { ok: false as const, message: "合格制请选择「合格」或「不合格」。" };
  }
  return { ok: true as const, entered: true, absent: false, score: null, gradeLabel, comment: commentCheck.comment };
}

export function resultDisplay(input: {
  mode: ExamScoreModeValue;
  score: number | null;
  gradeLabel: string | null;
  absent: boolean;
  entered: boolean;
  maxScore: number | null;
}) {
  if (!input.entered) return "未录入";
  if (input.absent) return "缺考";
  if (input.mode === "POINTS") {
    const score = input.score == null ? "—" : String(input.score);
    return input.maxScore != null ? `${score} / ${input.maxScore}` : score;
  }
  return input.gradeLabel || "—";
}

/** 已录入且非缺考的分数均分；无人则 null。 */
export function classAverage(scores: Array<number | null | undefined>) {
  const nums = scores.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (nums.length === 0) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  return Math.round((sum / nums.length) * 10) / 10;
}

export function parentCanSeeResult(examStatus: ExamStatusValue, entered: boolean) {
  return examStatus === "PUBLISHED" && entered;
}

/** 班级总结里若出现其他学生姓名，给出软提示（不强制拦截，避免误伤同名词）。 */
export function summaryMentionsOtherStudents(summary: string, names: string[], selfName: string) {
  const text = summary.trim();
  if (!text) return [] as string[];
  return names.filter((name) => name !== selfName && name.length >= 2 && text.includes(name));
}
