import { OwnerReports } from "@/components/owner-reports";
import { requireRole } from "@/lib/auth";
import { formatClock, formatDateLabel, formatDateTime, shanghaiDateKey, shanghaiWeekRange } from "@/lib/datetime";
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

export default async function OwnerReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requireRole("OWNER", "owner");
  const params = await searchParams;
  const statusFilter = params.status ? statusAliases[params.status] ?? null : null;
  const statusOptionValue = statusFilter ? statusOption[statusFilter] : null;
  const week = shanghaiWeekRange();
  const where = { organizationId: user.organizationId };
  const listWhere = {
    ...where,
    ...(statusFilter === "待确认" ? { status: { in: pendingStatuses } } : statusFilter ? { status: statusFilter as ReportStatus } : {}),
  };
  const [reports, generatedThisWeek, pending, returned, published] = await Promise.all([
    prisma.teachingReport.findMany({
      where: listWhere,
      include: {
        student: { select: { name: true } },
        lessonSession: {
          select: {
            title: true,
            startAt: true,
            course: { select: { name: true } },
            teacher: { select: { name: true } },
          },
        },
        teachingRecord: { select: { teacherPrivateNote: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
    prisma.teachingReport.count({ where: { ...where, generatedAt: { gte: week.start, lt: week.end } } }),
    prisma.teachingReport.count({ where: { ...where, status: { in: ["DRAFT", "CONFIRMED"] } } }),
    prisma.teachingReport.count({ where: { ...where, status: "RETURNED" } }),
    prisma.teachingReport.count({ where: { ...where, status: "PUBLISHED" } }),
  ]);

  return (
    <OwnerReports
      statusFilter={statusOptionValue}
      counts={{ generatedThisWeek, pending, returned, published }}
      reports={reports.map((report) => ({
        id: report.id,
        studentName: report.student.name,
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
      }))}
    />
  );
}
