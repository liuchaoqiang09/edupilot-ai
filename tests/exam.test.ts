import assert from "node:assert/strict";
import test from "node:test";
import {
  classAverage,
  parentCanSeeResult,
  parseExamDateKey,
  parseExamResultInput,
  resultDisplay,
  validateExamTitle,
} from "@/lib/exam";

test("EX-01 创建校验：标题与日期", () => {
  assert.equal(validateExamTitle("").ok, false);
  assert.equal(validateExamTitle("10月单元测").ok, true);
  assert.ok(parseExamDateKey("2026-10-20"));
  assert.equal(parseExamDateKey("2026-13-01"), null);
});

test("EX-02 分数录入：空白未录入；越界失败；缺考优先", () => {
  const empty = parseExamResultInput({ mode: "POINTS", maxScore: 100, absent: false, scoreRaw: "", gradeRaw: "", commentRaw: "" });
  assert.equal(empty.ok && empty.entered, false);

  const over = parseExamResultInput({ mode: "POINTS", maxScore: 100, absent: false, scoreRaw: "101", gradeRaw: "", commentRaw: "" });
  assert.equal(over.ok, false);

  const absent = parseExamResultInput({ mode: "POINTS", maxScore: 100, absent: true, scoreRaw: "90", gradeRaw: "", commentRaw: "请假" });
  assert.equal(absent.ok, true);
  if (absent.ok) {
    assert.equal(absent.entered, true);
    assert.equal(absent.absent, true);
    assert.equal(absent.score, null);
  }
});

test("EX-03 合格制只允许合格/不合格", () => {
  const bad = parseExamResultInput({ mode: "PASS_FAIL", maxScore: null, absent: false, scoreRaw: "", gradeRaw: "良好", commentRaw: "" });
  assert.equal(bad.ok, false);
  const ok = parseExamResultInput({ mode: "PASS_FAIL", maxScore: null, absent: false, scoreRaw: "", gradeRaw: "合格", commentRaw: "" });
  assert.equal(ok.ok && ok.entered, true);
});

test("EX-04 家长可见性：仅已发布且已录入", () => {
  assert.equal(parentCanSeeResult("DRAFT", true), false);
  assert.equal(parentCanSeeResult("PUBLISHED", false), false);
  assert.equal(parentCanSeeResult("PUBLISHED", true), true);
});

test("EX-05 展示与均分不泄露他人明细", () => {
  assert.equal(resultDisplay({ mode: "POINTS", score: 88, gradeLabel: null, absent: false, entered: true, maxScore: 100 }), "88 / 100");
  assert.equal(resultDisplay({ mode: "POINTS", score: null, gradeLabel: null, absent: true, entered: true, maxScore: 100 }), "缺考");
  assert.equal(classAverage([90, 80, null]), 85);
  assert.equal(classAverage([]), null);
});
