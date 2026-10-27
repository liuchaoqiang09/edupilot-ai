import assert from "node:assert/strict";
import test from "node:test";
import type { BillingListRow } from "../lib/billing-list.ts";
import { billingUsageLabel, compareBillingRows, compareBillingUrgency, compareCourseMates, matchesBillingFilter, needsBillingFollowUp, shiftDateKey } from "../lib/billing-list.ts";

const today = "2026-10-24";

function row(patch: Partial<BillingListRow> & Pick<BillingListRow, "name">): BillingListRow {
  return {
    studentNo: "STU-0001",
    courseName: "课程",
    enrolled: true,
    billingType: "PER_LESSON",
    remainingHours: 10,
    validUntil: null,
    periodStatus: null,
    followUp: false,
    arrears: false,
    paidAtTime: null,
    ...patch,
  };
}

test("即将过期只收结束前 5 天的周期课程和剩余 1 到 5 节的按课时报名", () => {
  const withinFive = row({ name: "五天内", billingType: "PER_PERIOD", remainingHours: null, validUntil: shiftDateKey(today, 5), periodStatus: "有效中" });
  const sixthDay = row({ name: "第六天", billingType: "PER_PERIOD", remainingHours: null, validUntil: shiftDateKey(today, 6), periodStatus: "有效中" });
  const monthsAway = row({ name: "周予安", billingType: "PER_PERIOD", remainingHours: null, validUntil: "2027-01-31", periodStatus: "有效中" });
  const fiveHours = row({ name: "郑一鸣", remainingHours: 5 });
  const sixHours = row({ name: "刘昭铭", remainingHours: 6 });
  assert.equal(billingUsageLabel(withinFive, today), "即将过期");
  assert.equal(billingUsageLabel(sixthDay, today), "有效中");
  assert.equal(billingUsageLabel(monthsAway, today), "有效中");
  assert.equal(billingUsageLabel(fiveHours, today), "课时不足");
  assert.equal(billingUsageLabel(sixHours, today), "正常");
  assert.equal(matchesBillingFilter(withinFive, "即将过期", today), true);
  assert.equal(matchesBillingFilter(sixthDay, "即将过期", today), false);
  assert.equal(matchesBillingFilter(monthsAway, "即将过期", today), false);
  assert.equal(matchesBillingFilter(fiveHours, "即将过期", today), true);
  assert.equal(matchesBillingFilter(sixHours, "即将过期", today), false);
  assert.equal(needsBillingFollowUp(fiveHours, today), true);
  assert.equal(needsBillingFollowUp(sixHours, today), false);
  assert.equal(needsBillingFollowUp(monthsAway, today), false);
  assert.equal(needsBillingFollowUp(withinFive, today), true);
  assert.equal(needsBillingFollowUp(row({ name: "零课时", remainingHours: 0 }), today), true);
  const ordered = [fiveHours, monthsAway, withinFive].sort((left, right) => compareBillingUrgency(left, right, today));
  assert.deepEqual(ordered.map((item) => item.name), ["五天内", "周予安", "郑一鸣"]);
});

test("已过期和 0 课时进入对应筛选，没有课时或日期的记录排在该项排序最后", () => {
  const expired = row({ name: "江晚晴", billingType: "PER_PERIOD", remainingHours: null, validUntil: "2026-09-30", periodStatus: "已过期" });
  const empty = row({ name: "零课时", remainingHours: 0 });
  const period = row({ name: "周期", billingType: "PER_PERIOD", remainingHours: null, validUntil: "2027-01-31", periodStatus: "有效中" });
  assert.equal(matchesBillingFilter(expired, "已过期", today), true);
  assert.equal(matchesBillingFilter(empty, "已过期", today), true);
  assert.equal(matchesBillingFilter(period, "已过期", today), false);
  const byHours = [period, empty, row({ name: "六节", remainingHours: 6 })].sort((left, right) => compareBillingRows(left, right, "hours", "asc", today));
  assert.deepEqual(byHours.map((item) => item.name), ["零课时", "六节", "周期"]);
  const byDate = [empty, period, expired].sort((left, right) => compareBillingRows(left, right, "validUntil", "asc", today));
  assert.deepEqual(byDate.map((item) => item.name), ["周期", "江晚晴", "零课时"]);
});

test("同名学员按学生编号固定次序，同课程按学员姓名再按编号", () => {
  const laterNo = row({ name: "顾星野", studentNo: "STU-0008", courseName: "创意美术" });
  const earlierNo = row({ name: "顾星野", studentNo: "STU-0002", courseName: "初二数学培优" });
  const other = row({ name: "陈可欣", studentNo: "STU-0009", courseName: "创意美术" });
  const byName = [laterNo, other, earlierNo].sort((left, right) => compareBillingRows(left, right, "name", "desc", today));
  assert.deepEqual(byName.map((item) => `${item.name}:${item.studentNo}`), ["顾星野:STU-0002", "顾星野:STU-0008", "陈可欣:STU-0009"]);
  const mates = [laterNo, other].sort(compareCourseMates);
  assert.deepEqual(mates.map((item) => item.name), ["陈可欣", "顾星野"]);
});

test("状态排序把四类优先状态放在前面，降序时这四类反过来", () => {
  const unenrolled = row({ name: "爱德华", enrolled: false, billingType: null, remainingHours: null, studentNo: "STU-0011" });
  const expired = row({ name: "江晚晴", billingType: "PER_PERIOD", remainingHours: null, validUntil: "2026-09-30", periodStatus: "已过期", studentNo: "STU-0003" });
  const empty = row({ name: "零课时", remainingHours: 0, studentNo: "STU-0004" });
  const low = row({ name: "郑一鸣", remainingHours: 5, studentNo: "STU-0005" });
  const normal = row({ name: "林子涵", remainingHours: 19, studentNo: "STU-0001" });
  const rows = [normal, low, empty, expired, unenrolled];
  const asc = [...rows].sort((left, right) => compareBillingRows(left, right, "status", "asc", today));
  assert.deepEqual(asc.map((item) => item.name), ["爱德华", "江晚晴", "零课时", "郑一鸣", "林子涵"]);
  const desc = [...rows].sort((left, right) => compareBillingRows(left, right, "status", "desc", today));
  assert.deepEqual(desc.map((item) => item.name), ["郑一鸣", "零课时", "江晚晴", "爱德华", "林子涵"]);
});

test("最近缴费按时间先后排序，没有缴费的排在最后", () => {
  const early = row({ name: "早", paidAtTime: Date.parse("2026-09-18T03:30:00.000Z") });
  const late = row({ name: "晚", paidAtTime: Date.parse("2026-10-21T03:30:00.000Z") });
  const none = row({ name: "无", paidAtTime: null });
  const desc = [none, early, late].sort((left, right) => compareBillingRows(left, right, "paidAt", "desc", today));
  assert.deepEqual(desc.map((item) => item.name), ["晚", "早", "无"]);
  const asc = [none, late, early].sort((left, right) => compareBillingRows(left, right, "paidAt", "asc", today));
  assert.deepEqual(asc.map((item) => item.name), ["早", "晚", "无"]);
});
