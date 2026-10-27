import assert from "node:assert/strict";
import test from "node:test";
import { arrearsCents, enrollmentStanding, payableCents } from "../lib/enrollment-money.ts";
import { matchesBillingFilter } from "../lib/billing-list.ts";
import type { BillingListRow } from "../lib/billing-list.ts";

test("报名状态按应收和未作废实收计算", () => {
  assert.equal(enrollmentStanding(10000, 0), "UNPAID");
  assert.equal(enrollmentStanding(10000, 4000), "PARTIAL");
  assert.equal(enrollmentStanding(10000, 10000), "PAID");
  assert.equal(enrollmentStanding(10000, 12000), "PAID");
  assert.equal(enrollmentStanding(0, 0), "PAID");
  assert.equal(arrearsCents(10000, 4000), 6000);
  assert.equal(arrearsCents(10000, 10000), 0);
});

test("填了折扣时，实收达到折后应收就不算欠费", () => {
  assert.equal(payableCents(100000, 75), 75000);
  assert.equal(enrollmentStanding(100000, 75000, 75), "PAID");
  assert.equal(enrollmentStanding(100000, 50000, 75), "PARTIAL");
  assert.equal(enrollmentStanding(100000, 0, 75), "UNPAID");
  assert.equal(arrearsCents(100000, 75000, 75), 0);
  assert.equal(arrearsCents(100000, 50000, 75), 25000);
  assert.equal(arrearsCents(100000, 75000, null), 25000);
});

test("欠费筛选只看应收大于实收", () => {
  const row = (arrears: boolean): BillingListRow => ({
    name: "学员",
    studentNo: "STU-0001",
    courseName: "课程",
    enrolled: true,
    billingType: "PER_LESSON",
    remainingHours: 8,
    validUntil: null,
    periodStatus: null,
    followUp: false,
    arrears,
    paidAtTime: null,
  });
  assert.equal(matchesBillingFilter(row(true), "欠费", "2026-10-26"), true);
  assert.equal(matchesBillingFilter(row(false), "欠费", "2026-10-26"), false);
});
