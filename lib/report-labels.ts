export const reportStatusLabel = {
  DRAFT: "草稿",
  CONFIRMED: "已确认",
  PUBLISHED: "已发布",
  RETURNED: "已退回",
} as const;

export type ReportStatusValue = keyof typeof reportStatusLabel;
