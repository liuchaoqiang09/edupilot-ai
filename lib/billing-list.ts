import type { PeriodValidity } from "@/lib/course-hours";

export const soonStatusDays = 5;
export const lowHourStatusThreshold = 5;

export const billingQuickFilters = ["未报名", "已过期", "即将过期"] as const;

export type BillingQuickFilter = (typeof billingQuickFilters)[number];

export const billingSortFields = ["name", "course", "hours", "validUntil", "paidAt", "status"] as const;

export type BillingSortField = (typeof billingSortFields)[number];

export type BillingListRow = {
  name: string;
  studentNo: string | null;
  courseName: string;
  enrolled: boolean;
  billingType: "PER_LESSON" | "PER_PERIOD" | null;
  remainingHours: number | null;
  validUntil: string | null;
  periodStatus: PeriodValidity | null;
  followUp: boolean;
  arrears: boolean;
  paidAtTime: number | null;
};

export function shiftDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function matchesBillingFilter(row: BillingListRow, filter: BillingQuickFilter | "待续费" | "欠费" | null, today: string) {
  if (filter === "欠费") return row.arrears;
  if (filter === "未报名") return !row.enrolled;
  if (filter === "待续费") return row.followUp;
  if (filter === "已过期") {
    if (row.billingType === "PER_PERIOD") return row.periodStatus === "已过期";
    return row.billingType === "PER_LESSON" && row.remainingHours === 0;
  }
  if (filter === "即将过期") {
    const label = billingUsageLabel(row, today);
    return label === "即将过期" || label === "课时不足";
  }
  return true;
}

export function matchesBillingQuery(row: Pick<BillingListRow, "name" | "courseName">, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return row.name.toLowerCase().includes(needle) || row.courseName.toLowerCase().includes(needle);
}

export function compareMissingLast(left: number | string | null, right: number | string | null, order: "asc" | "desc") {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  if (left === right) return 0;
  const ascending = left < right ? -1 : 1;
  return order === "asc" ? ascending : -ascending;
}

function compareValidity(left: string | null, right: string | null, today: string, order: "asc" | "desc") {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  const leftFuture = left >= today;
  const rightFuture = right >= today;
  let ascending = 0;
  if (leftFuture !== rightFuture) ascending = leftFuture ? -1 : 1;
  else if (leftFuture) ascending = left < right ? -1 : left > right ? 1 : 0;
  else ascending = left > right ? -1 : left < right ? 1 : 0;
  return order === "asc" ? ascending : -ascending;
}

const healthyStatusRank = 5;

export function billingUsageLabel(row: {
  enrolled: boolean;
  billingType: BillingListRow["billingType"];
  periodStatus: PeriodValidity | null;
  remainingHours: number | null;
  validUntil: string | null;
}, today: string) {
  if (!row.enrolled) return "未报名";
  if (row.billingType === "PER_PERIOD") {
    if (row.periodStatus === "有效中" && row.validUntil != null && row.validUntil <= shiftDateKey(today, soonStatusDays)) return "即将过期";
    return row.periodStatus ?? "有效中";
  }
  if (row.remainingHours === 0) return "无课时";
  if (row.remainingHours != null && row.remainingHours > 0 && row.remainingHours <= lowHourStatusThreshold) return "课时不足";
  return "正常";
}

const followUpLabels = new Set(["课时不足", "无课时", "已过期", "未填写有效期", "即将过期"]);

export function formatCourseUsage(row: {
  enrolled: boolean;
  billingType: "PER_LESSON" | "PER_PERIOD" | null;
  periodStatus: PeriodValidity | null;
  remainingHours: number | null;
  validUntil: string | null;
}, today: string) {
  if (!row.enrolled || !row.billingType) return "未报名";
  const label = billingUsageLabel({ ...row, enrolled: true, billingType: row.billingType }, today);
  if (row.billingType === "PER_LESSON") {
    const hours = `剩余 ${row.remainingHours ?? 0} 节`;
    return label === "正常" ? hours : `${hours} · ${label}`;
  }
  if (!row.validUntil) return label;
  return label === "有效中" || label === "未开始" ? `至 ${row.validUntil}` : `至 ${row.validUntil} · ${label}`;
}

export function needsBillingFollowUp(row: {
  enrolled: boolean;
  billingType: BillingListRow["billingType"];
  periodStatus: PeriodValidity | null;
  remainingHours: number | null;
  validUntil: string | null;
}, today: string) {
  return followUpLabels.has(billingUsageLabel(row, today));
}

export function billingStatusRank(row: {
  enrolled: boolean;
  billingType: BillingListRow["billingType"];
  periodStatus: PeriodValidity | null;
  remainingHours: number | null;
  validUntil: string | null;
}, today: string) {
  const label = billingUsageLabel(row, today);
  if (label === "未报名") return 0;
  if (label === "已过期") return 1;
  if (label === "无课时") return 2;
  if (label === "课时不足") return 3;
  if (label === "即将过期") return 4;
  return healthyStatusRank;
}

export function compareStatusRanks(leftRank: number, rightRank: number, order: "asc" | "desc") {
  if ((leftRank === healthyStatusRank) !== (rightRank === healthyStatusRank)) return leftRank === healthyStatusRank ? 1 : -1;
  if (leftRank === rightRank) return 0;
  const diff = leftRank - rightRank;
  return order === "asc" ? diff : -diff;
}

function compareStatus(left: BillingListRow, right: BillingListRow, order: "asc" | "desc", today: string) {
  const ranked = compareStatusRanks(billingStatusRank(left, today), billingStatusRank(right, today), order);
  return ranked || compareStudentIdentity(left, right);
}

function compareStudentIdentity(left: BillingListRow, right: BillingListRow) {
  return left.name.localeCompare(right.name, "zh-CN")
    || compareMissingLast(left.studentNo, right.studentNo, "asc")
    || left.courseName.localeCompare(right.courseName, "zh-CN");
}

export function compareBillingRows(left: BillingListRow, right: BillingListRow, sortBy: Exclude<BillingSortField, "course">, order: "asc" | "desc", today: string) {
  if (sortBy === "name") {
    const nameOrder = left.name.localeCompare(right.name, "zh-CN");
    const directed = order === "asc" ? nameOrder : -nameOrder;
    if (directed !== 0) return directed;
    return compareMissingLast(left.studentNo, right.studentNo, "asc") || left.courseName.localeCompare(right.courseName, "zh-CN");
  }
  if (sortBy === "hours") return compareMissingLast(left.remainingHours, right.remainingHours, order) || compareStudentIdentity(left, right);
  if (sortBy === "validUntil") return compareValidity(left.validUntil, right.validUntil, today, order) || compareStudentIdentity(left, right);
  if (sortBy === "status") return compareStatus(left, right, order, today);
  return compareMissingLast(left.paidAtTime, right.paidAtTime, order) || compareStudentIdentity(left, right);
}

export function compareCourseMates(left: BillingListRow, right: BillingListRow) {
  return compareStudentIdentity(left, right);
}

export function compareBillingUrgency(left: BillingListRow, right: BillingListRow, today: string) {
  return compareValidity(left.validUntil, right.validUntil, today, "asc")
    || compareMissingLast(left.remainingHours, right.remainingHours, "asc")
    || compareStudentIdentity(left, right);
}
