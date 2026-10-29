import { OwnerReports } from "@/components/owner-reports";
import { Pager, pageOf } from "@/components/pager";
import { requireRole } from "@/lib/auth";
import { dayRange, formatClock, formatDateLabel, formatDateTime, shanghaiDateKey, shanghaiWeekRange, shiftDate } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import type { ReportStatus } from "@prisma/client";

const pendingStatuses: ReportStatus[] = ["DRAFT", "CONFIRMED", "RETURNED"];
const statusAliases: Record<string, "待确认" | ReportStatus> = {
  待确认: "待确认",
  草稿: "DRAFT",
  已确认: "CONFIRMED",
  已发布: "PUBLISHED",
  已退回: "RETURNED",
  DRAFT: "DRAFT",
  CONFIRMED: "CONFIRMED",
  PUBLISHED: "PUBLISHED",
  RETURNED: "RETURNED",
};
const statusOption = {
  待确认: "待确认",
  DRAFT: "草稿",
  CONFIRMED: "已确认",
  PUBLISHED: "已发布",
  RETURNED: "已退回",
} as const;

function reportDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return shanghaiDateKey();
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return shanghaiDateKey();
  return value;
}

export default async function OwnerReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; date?: string; q?: string; all?: string; sort?: string; page?: string; report?: string }>;
}) {
  const user = await requireRole("OWNER", "owner");
  const params = await searchParams;
  const statusFilter = params.status ? statusAliases[params.status] ?? null : null;
  const statusOptionValue = statusFilter ? statusOption[statusFilter] : null;
  const showAll = params.all === "1";
  const sort = params.sort === "asc" || params.sort === "desc" ? params.sort : "default";
  const date = reportDate(params.date);
  const today = shanghaiDateKey();
  const studentQuery = params.q?.trim().slice(0, 40) ?? "";
  const range = dayRange(date);
  const week = shanghaiWeekRange();
  const where = { organizationId: user.organizationId };
  const lessonDirection = showAll && sort === "asc" ? "asc" : showAll ? "desc" : "asc";
  const listWhere = {
    ...where,
    ...(showAll ? {} : { lessonSession: { startAt: { gte: range.start, lt: range.end } } }),
    ...(statusFilter === "待确认" ? { status: { in: pendingStatuses } } : statusFilter ? { status: statusFilter as ReportStatus } : {}),
    ...(studentQuery
      ? {
          student: {
            OR: [
              { name: { contains: studentQuery, mode: "insensitive" as const } },
              { studentNo: { contains: studentQuery, mode: "insensitive" as const } },
            ],
          },
        }
      : {}),
  };
  const [reports, generatedThisWeek, pending, returned, published] = await Promise.all([
    prisma.teachingReport.findMany({
      where: listWhere,
      include: {
        student: { select: { name: true, studentNo: true } },
        lessonSession: {
          select: {
            title: true,
            startAt: true,
            course: { select: { name: true } },
            teacher: { select: { name: true } },
          },
        },
        teachingRecord: { select: { teacherPrivateNote: true } },
        reads: { orderBy: { openedAt: "asc" }, select: { openedAt: true, parent: { select: { name: true } } } },
        replies: { orderBy: { updatedAt: "desc" }, select: { body: true, parent: { select: { name: true } } } },
      },
      orderBy: [{ lessonSession: { startAt: lessonDirection } }, { student: { name: "asc" } }],
    }),
    prisma.teachingReport.count({ where: { ...where, generatedAt: { gte: week.start, lt: week.end } } }),
    prisma.teachingReport.count({ where: { ...where, status: { in: ["DRAFT", "CONFIRMED"] } } }),
    prisma.teachingReport.count({ where: { ...where, status: "RETURNED" } }),
    prisma.teachingReport.count({ where: { ...where, status: "PUBLISHED" } }),
  ]);

  const mappedReports = reports.map((report) => ({
    id: report.id,
    studentName: report.student.name,
    studentNo: report.student.studentNo,
    title: report.lessonSession.title ?? "课次",
    courseName: report.lessonSession.course.name,
    teacherName: report.lessonSession.teacher.name,
    when: `${formatDateLabel(shanghaiDateKey(report.lessonSession.startAt))} ${formatClock(report.lessonSession.startAt)}`,
    status: report.status,
    summary: report.summary,
    strengths: report.strengths,
    issues: report.issues,
    nextSteps: report.nextSteps,
    homeworkSummary: report.homeworkSummary ?? "",
    evidence: report.aiModel
      ? `模型 ${report.aiModel}${report.generatedAt ? ` · ${formatDateTime(report.generatedAt)}` : ""}`
      : "还没有模型记录",
    revision: report.revision,
    revisionNote: report.revisionNote,
    privateNote: report.teachingRecord.teacherPrivateNote,
    reads: report.reads.map((read) => ({ parentName: read.parent.name, openedAt: formatDateTime(read.openedAt) })),
    parentReply: report.replies.map((reply) => `${reply.parent.name}：${reply.body}`).join("\n"),
  }));
  const reportId = params.report ?? "";
  const openedReport = reportId ? mappedReports.find((report) => report.id === reportId) : null;
  const orderedReports = openedReport ? [openedReport, ...mappedReports.filter((report) => report.id !== openedReport.id)] : mappedReports;
  const window = pageOf(params.page, orderedReports.length);
  function pageHref(page: number) {
    const next = new URLSearchParams();
    if (params.status) next.set("status", params.status);
    if (params.date) next.set("date", params.date);
    if (studentQuery) next.set("q", studentQuery);
    if (showAll) next.set("all", "1");
    if (sort !== "default") next.set("sort", sort);
    if (reportId) next.set("report", reportId);
    if (page > 1) next.set("page", String(page));
    const text = next.toString();
    return text ? `/owner/reports?${text}` : "/owner/reports";
  }

  return (
    <>
    <OwnerReports
      statusFilter={statusOptionValue}
      showAll={showAll}
      sort={sort}
      date={date}
      dateLabel={formatDateLabel(date)}
      yesterday={shiftDate(today, -1)}
      today={today}
      query={studentQuery}
      counts={{ generatedThisWeek, pending, returned, published }}
      reports={orderedReports.slice(window.start, window.start + 20)}
      selectedReportId={reportId}
    />
    {window.pages > 1 ? (
      <div className="mt-3 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        <Pager page={window.page} pages={window.pages} href={pageHref} />
      </div>
    ) : null}
    </>
  );
}
