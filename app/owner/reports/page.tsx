import { OwnerReports } from "@/components/owner-reports";
import { requireRole } from "@/lib/auth";
import { formatClock, formatDateLabel, shanghaiDateKey } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import type { ReportStatus } from "@prisma/client";

const statuses = new Set<ReportStatus>(["DRAFT", "CONFIRMED", "PUBLISHED", "RETURNED"]);

export default async function OwnerReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requireRole("OWNER", "owner");
  const params = await searchParams;
  const status = params.status && statuses.has(params.status as ReportStatus) ? (params.status as ReportStatus) : undefined;
  const reports = await prisma.teachingReport.findMany({
    where: { organizationId: user.organizationId, ...(status ? { status } : {}) },
    include: {
      student: { select: { name: true } },
      lessonSession: { select: { title: true, startAt: true, teacher: { select: { name: true } } } },
      teachingRecord: { select: { teacherPrivateNote: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  return (
    <OwnerReports
      status={status ?? ""}
      reports={reports.map((report) => ({
        id: report.id,
        studentName: report.student.name,
        title: report.lessonSession.title ?? "课次",
        teacherName: report.lessonSession.teacher.name,
        when: `${formatDateLabel(shanghaiDateKey(report.lessonSession.startAt))} ${formatClock(report.lessonSession.startAt)}`,
        status: report.status,
        summary: report.summary,
        revisionNote: report.revisionNote,
        privateNote: report.teachingRecord.teacherPrivateNote,
      }))}
    />
  );
}
