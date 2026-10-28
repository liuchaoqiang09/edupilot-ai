import type { ParentNoticeKind, Prisma } from "@prisma/client";

export const noticeKindLabel = {
  LESSON: "课次",
  HOMEWORK: "作业",
  REPORT: "报告",
  MAKEUP: "补课",
  EXAM: "成绩",
} as const;

export const noticeStatusTabs = [
  { id: "all", label: "全部" },
  { id: "unread", label: "未读" },
  { id: "read", label: "已读" },
] as const;

export const noticeKindTabs = [
  { id: "all", label: "全部类型" },
  { id: "HOMEWORK", label: "作业" },
  { id: "EXAM", label: "成绩" },
  { id: "REPORT", label: "报告" },
  { id: "LESSON", label: "课次" },
  { id: "MAKEUP", label: "补课" },
] as const;

export type NoticeStatus = (typeof noticeStatusTabs)[number]["id"];
export type NoticeKindTab = (typeof noticeKindTabs)[number]["id"];

export function parseNoticeStatus(raw: string | undefined): NoticeStatus {
  return noticeStatusTabs.some((tab) => tab.id === raw) ? (raw as NoticeStatus) : "all";
}

export function parseNoticeKind(raw: string | undefined): NoticeKindTab {
  return noticeKindTabs.some((tab) => tab.id === raw) ? (raw as NoticeKindTab) : "all";
}

export function parseNoticeOrder(raw: string | undefined): "asc" | "desc" {
  return raw === "asc" ? "asc" : "desc";
}

/** 兼容旧链接 ?tab=unread|HOMEWORK 等。 */
export function legacyNoticeParams(tab: string | undefined): { status?: NoticeStatus; kind?: NoticeKindTab } {
  if (!tab) return {};
  if (tab === "unread" || tab === "read" || tab === "all") return { status: tab };
  if (noticeKindTabs.some((item) => item.id === tab)) return { kind: tab as NoticeKindTab };
  return {};
}

export function noticeWhere(input: {
  organizationId: string;
  parentUserId: string;
  status: NoticeStatus;
  kind: NoticeKindTab;
}): Prisma.ParentNoticeWhereInput {
  return {
    organizationId: input.organizationId,
    parentUserId: input.parentUserId,
    ...(input.status === "unread" ? { readAt: null } : {}),
    ...(input.status === "read" ? { readAt: { not: null } } : {}),
    ...(input.kind !== "all" ? { kind: input.kind as ParentNoticeKind } : {}),
  };
}

export function noticeOrderBy(order: "asc" | "desc"): Prisma.ParentNoticeOrderByWithRelationInput[] {
  return [{ occurredAt: order }, { createdAt: order }, { id: order }];
}

export function noticeListHref(input: {
  status?: NoticeStatus;
  kind?: NoticeKindTab;
  order?: "asc" | "desc";
  page?: number;
}) {
  const search = new URLSearchParams();
  if (input.status && input.status !== "all") search.set("status", input.status);
  if (input.kind && input.kind !== "all") search.set("kind", input.kind);
  if (input.order === "asc") search.set("order", "asc");
  if (input.page && input.page > 1) search.set("page", String(input.page));
  const text = search.toString();
  return text ? `/parent/notices?${text}` : "/parent/notices";
}

/** 从正文里的业务日期推断排序时间，用于历史消息回填。 */
export function inferOccurredAtFromBody(body: string, fallback: Date): Date {
  const cn = body.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (cn) {
    const year = cn[1];
    const month = cn[2].padStart(2, "0");
    const day = cn[3].padStart(2, "0");
    const time = body.slice(cn.index! + cn[0].length).match(/(\d{1,2}):(\d{2})/);
    const hour = time ? time[1].padStart(2, "0") : "12";
    const minute = time ? time[2] : "00";
    const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:00+08:00`);
    return Number.isNaN(date.getTime()) ? fallback : date;
  }

  // formatDateTime 产出「M/D HH:mm」，无年份时用送达年回推。
  const short = body.match(/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (short) {
    const year = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
    }).format(fallback);
    const month = short[1].padStart(2, "0");
    const day = short[2].padStart(2, "0");
    const hour = short[3].padStart(2, "0");
    const minute = short[4];
    const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:00+08:00`);
    return Number.isNaN(date.getTime()) ? fallback : date;
  }

  return fallback;
}
