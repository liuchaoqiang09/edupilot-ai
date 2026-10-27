export type Locale = "zh-CN" | "en";

export function normalizeLocale(value: string | null | undefined): Locale {
  return value === "en" ? "en" : "zh-CN";
}

export function pick(locale: Locale, zh: string, en: string) {
  return locale === "en" ? en : zh;
}

const publicLabels: Record<string, string> = {
  未报名: "Not enrolled",
  在读: "Enrolled",
  已停用: "Inactive",
  有效中: "In term",
  即将过期: "Expiring soon",
  快过期: "Expiring soon",
  课时不足: "Low hours",
  已过期: "Expired",
  无课时: "No hours",
  正常: "On track",
  未填写有效期: "No end date",
  未开始: "Not started",
  草稿: "Draft",
  已确认: "Confirmed",
  已发布: "Published",
  已退回: "Returned",
  待确认: "Needs review",
  未标记: "Not marked",
  出勤: "Present",
  迟到: "Late",
  请假: "Excused",
  缺勤: "Absent",
  已缴费: "Paid",
  部分缴费: "Partly paid",
  未缴费: "Unpaid",
  必填: "Required",
  在职: "Active",
  同课程不同班: "Same course, other class",
  未报名此课程: "Not enrolled in this course",
  本班: "Class",
  临时: "Guest",
  试听: "Trial",
  已转正: "Enrolled",
  待联系: "To contact",
  已联系: "Contacted",
  已约下次: "Next visit booked",
  已拒绝: "Declined",
  已续费: "Renewed",
  非本班报名: "Not enrolled in this class",
  欠费: "Overdue",
  已归档: "Archived",
};

export function publicLabel(locale: Locale, text: string) {
  if (locale !== "en") return text;
  if (publicLabels[text]) return publicLabels[text];
  const expired = /^已过期 (.+)$/.exec(text);
  if (expired) return `Expired ${expired[1]}`;
  const low = /^课时不足 剩余 (\d+) 课时$/.exec(text);
  if (low) return `Low hours, ${low[1]} left`;
  const hours = /^剩余 (\d+) 节$/.exec(text);
  if (hours) return `${hours[1]} left`;
  const until = /^至 (.+)$/.exec(text);
  if (until) return `Until ${until[1]}`;
  return text;
}
