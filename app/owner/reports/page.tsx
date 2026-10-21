import { OwnerReports } from "@/components/owner-reports";
import { requireRole } from "@/lib/auth";
import { formatClock, formatDateLabel, formatDateTime, shanghaiDateKey, shanghaiWeekRange } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";

export default async function OwnerReportsPage() {
  const user = await requireRole("OWNER", "owner");
  const week = shanghaiWeekRange();
  const where = { organizationId: user.organizationId };
  const [reports, generatedThisWeek, pending, returned, published] = await Promise.all([
    prisma.teachingReport.findMany({
      where,
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
