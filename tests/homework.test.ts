import assert from "node:assert/strict";
import test from "node:test";
import {
  canParentEditSubmission,
  canTeacherReview,
  homeworkOverdue,
  isHomeworkLocked,
  listHomeworkStatus,
  submissionHasContent,
  validateFeedback,
  validateHomeworkBody,
  validateScore,
} from "@/lib/homework";
import { classifyHomeworkFile, writeHomeworkAssetFiles, removeHomeworkAssetFile } from "@/lib/homework-files";

test("列表状态与家长可否编辑", () => {
  assert.equal(listHomeworkStatus(null), "PENDING");
  assert.equal(canParentEditSubmission(null), true);
  assert.equal(canParentEditSubmission("SUBMITTED"), true);
  assert.equal(canParentEditSubmission("RETURNED"), true);
  assert.equal(canParentEditSubmission("GRADED"), false);
  assert.equal(isHomeworkLocked("COMPLETED"), true);
});

test("逾期：仅未交或已退回且超过截止", () => {
  const due = new Date("2026-01-01T12:00:00+08:00");
  const now = new Date("2026-01-02T12:00:00+08:00");
  assert.equal(homeworkOverdue(due, "PENDING", now), true);
  assert.equal(homeworkOverdue(due, "RETURNED", now), true);
  assert.equal(homeworkOverdue(due, "SUBMITTED", now), false);
  assert.equal(homeworkOverdue(null, "PENDING", now), false);
});

test("提交须有内容；教师可批已提交/已退回/已批改", () => {
  assert.equal(submissionHasContent("", 0, 0), false);
  assert.equal(submissionHasContent("写完了", 0, 0), true);
  assert.equal(submissionHasContent("", 1, 0), true);
  assert.equal(canTeacherReview("SUBMITTED"), true);
  assert.equal(canTeacherReview(null), false);
  assert.equal(validateHomeworkBody("x".repeat(2001)).ok, false);
});

test("附件 MIME 为空时按扩展名识别", () => {
  const file = new File([Buffer.from("%PDF-1.4")], "作业.pdf", { type: "" });
  const typed = classifyHomeworkFile(file);
  assert.equal(typed.ok, true);
  if (typed.ok) {
    assert.equal(typed.kind, "FILE");
    assert.equal(typed.ext, "pdf");
    assert.equal(typed.contentType, "application/pdf");
  }
});

test("评语与分数校验；退回场景空评语视为无内容", () => {
  assert.equal(validateFeedback("x".repeat(1001)).ok, false);
  assert.equal(validateScore("x".repeat(21)).ok, false);
  const empty = validateFeedback("   ");
  assert.equal(empty.ok, true);
  if (empty.ok) assert.equal(empty.feedback, null);
  const ok = validateScore("优秀");
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.score, "优秀");
});

test("拒绝不支持类型与超大文件；照片张数上限", async () => {
  const exe = classifyHomeworkFile(new File([Buffer.from("MZ")], "a.exe", { type: "application/octet-stream" }));
  assert.equal(exe.ok, false);
  const big = classifyHomeworkFile(new File([Buffer.alloc(2_000_001)], "big.jpg", { type: "image/jpeg" }));
  assert.equal(big.ok, false);

  const photos = Array.from({ length: 7 }, (_, i) => new File([Buffer.from(`img${i}`)], `p${i}.png`, { type: "image/png" }));
  const written = await writeHomeworkAssetFiles("org-test", "pending", photos, { images: 0, files: 0 });
  assert.equal(written.ok, false);
  if (!written.ok) {
    for (const asset of written.created) await removeHomeworkAssetFile(asset.id, asset.contentType);
  }
});
