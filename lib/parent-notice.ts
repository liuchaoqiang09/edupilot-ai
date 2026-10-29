import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { formatDateTime, shanghaiDateKey } from "@/lib/datetime";
import { makeupLabel } from "@/lib/lesson-seat";
import { inferOccurredAtFromBody } from "@/lib/parent-notices-ui";
import { safeParentHref } from "@/lib/parent-scope";
import { prisma } from "@/lib/prisma";

type NoticeKind = "LESSON" | "HOMEWORK" | "REPORT" | "MAKEUP" | "EXAM";

function refreshParent() {
  revalidatePath("/parent");
  revalidatePath("/parent/notices");
  revalidatePath("/parent/schedule");
  revalidatePath("/parent/homework");
  revalidatePath("/parent/reports");
  revalidatePath("/parent/exams");
}

export async function notifyLinkedParents(input: {
  organizationId: string;
  studentIds: string[];
  kind: NoticeKind;
  title: string;
  body: string;
  href: string;
  dedupeKey: string;
  /** 列表排序用的业务时间；缺省用当前送达时间。 */
  occurredAt?: Date;
}) {
  const ids = [...new Set(input.studentIds.filter(Boolean))];
  const href = safeParentHref(input.href, "");
  if (ids.length === 0 || !href) return;
  const links = await prisma.parentStudentLink.findMany({
    where: { organizationId: input.organizationId, studentId: { in: ids } },
    select: { parentUserId: true, student: { select: { name: true } } },
  });
  const byParent = new Map<string, string[]>();
  for (const link of links) {
    const names = byParent.get(link.parentUserId) ?? [];
    if (!names.includes(link.student.name)) names.push(link.student.name);
    byParent.set(link.parentUserId, names);
  }
  if (byParent.size === 0) return;
  const occurredAt = input.occurredAt ?? new Date();
  await prisma.parentNotice.createMany({
    data: [...byParent].map(([parentUserId, names]) => ({
      organizationId: input.organizationId,
      parentUserId,
      kind: input.kind,
      title: input.title,
      body: `${names.join("、")}：${input.body}`,
      href,
      dedupeKey: input.dedupeKey,
      occurredAt,
    })),
    skipDuplicates: true,
  });
  refreshParent();
}

export async function notifyLessonChange(input: {
  organizationId: string;
  studentIds: string[];
  title: string | null;
  when: Date;
  change: string;
  dedupeKey: string;
}) {
  const name = input.title?.trim() || "课次";
  await notifyLinkedParents({
    organizationId: input.organizationId,
    studentIds: input.studentIds,
    kind: "LESSON",
    title: `${name}有变动`,
    body: `${formatDateTime(input.when)}的「${name}」${input.change}`,
    href: `/parent/schedule?view=day&date=${shanghaiDateKey(input.when)}`,
    dedupeKey: input.dedupeKey,
    occurredAt: input.when,
  });
}

export async function notifyMakeupArranged(input: {
  organizationId: string;
  studentId: string;
  targetTitle: string | null;
  targetStart: Date;
  sourceStart: Date;
  lessonStudentId: string;
}) {
  const name = input.targetTitle?.trim() || "课次";
  await notifyLinkedParents({
    organizationId: input.organizationId,
    studentIds: [input.studentId],
    kind: "MAKEUP",
    title: "已安排补课",
    body: `${makeupLabel(input.sourceStart)}，补课是 ${formatDateTime(input.targetStart)} 的「${name}」`,
    href: `/parent/schedule?view=day&date=${shanghaiDateKey(input.targetStart)}`,
    dedupeKey: `makeup:${input.lessonStudentId}`,
    occurredAt: input.targetStart,
  });
}

export function homeworkKey(lessonId: string, homework: string) {
  const digest = createHash("sha256").update(homework).digest("hex").slice(0, 16);
  return `homework:${lessonId}:${digest}`;
}

export async function notifyHomeworkSaved(input: {
  organizationId: string;
  lessonId: string;
  title: string | null;
  when: Date;
  studentIds: string[];
  previous: string | null;
  homework: string;
}) {
  const next = input.homework.trim();
  if (!next || next === (input.previous ?? "").trim()) return;
  const name = input.title?.trim() || "课次";
  await notifyLinkedParents({
    organizationId: input.organizationId,
    studentIds: input.studentIds,
    kind: "HOMEWORK",
    title: "有新的作业",
    body: `${formatDateTime(input.when)}的「${name}」布置了作业`,
    href: "/parent/homework",
    dedupeKey: homeworkKey(input.lessonId, next),
    occurredAt: input.when,
  });
}

export async function notifyReportPublished(input: {
  organizationId: string;
  reportId: string;
  studentId: string;
  courseName: string;
  when: Date;
  publishedAt: Date;
}) {
  await notifyLinkedParents({
    organizationId: input.organizationId,
    studentIds: [input.studentId],
    kind: "REPORT",
    title: "教学报告已发布",
    body: `${formatDateTime(input.when)}的${input.courseName}报告可以查看`,
    href: `/parent/reports?focus=${input.reportId}`,
    dedupeKey: `report:${input.reportId}:${input.publishedAt.toISOString()}`,
    occurredAt: input.when,
  });
}

export async function notifyReportReturned(input: {
  organizationId: string;
  reportId: string;
  studentId: string;
  courseName: string;
  when: Date;
  reason: string;
}) {
  const note = input.reason.trim().slice(0, 80);
  await notifyLinkedParents({
    organizationId: input.organizationId,
    studentIds: [input.studentId],
    kind: "REPORT",
    title: "教学报告已撤回",
    body: `${formatDateTime(input.when)}的${input.courseName}报告已撤回，暂时不可查看${note ? `（${note}）` : ""}`,
    href: "/parent/reports",
    dedupeKey: `report-return:${input.reportId}:${Date.now()}`,
    occurredAt: input.when,
  });
}

/** 用正文里的业务日期回填历史消息的 occurredAt。 */
export async function backfillNoticeOccurredAt() {
  const rows = await prisma.parentNotice.findMany({
    select: { id: true, body: true, createdAt: true, occurredAt: true },
  });
  let updated = 0;
  for (const row of rows) {
    const next = inferOccurredAtFromBody(row.body, row.createdAt);
    if (next.getTime() === row.occurredAt.getTime()) continue;
    await prisma.parentNotice.update({ where: { id: row.id }, data: { occurredAt: next } });
    updated += 1;
  }
  return updated;
}
