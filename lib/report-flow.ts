import { Prisma, PrismaClient } from "@prisma/client";
import { AiReportError, type GeneratedReport, normalizeReportLanguage, type ReportLanguage } from "./ai-service";
import { writeAudit } from "./audit";
import { notifyReportPublished } from "./parent-notice";
import { shanghaiDateKey } from "./datetime";

type Db = PrismaClient | Prisma.TransactionClient;

export type OrgReportSettings = {
  reportLanguage: ReportLanguage;
  aiUseRecentSummaries: boolean;
  aiTeacherMustConfirm: boolean;
  aiRequireEvidence: boolean;
};

export function readOrgReportSettings(
  org: {
    reportLanguage: string;
    aiUseRecentSummaries: boolean;
    aiTeacherMustConfirm: boolean;
    aiRequireEvidence?: boolean;
  } | null,
): OrgReportSettings {
  return {
    reportLanguage: normalizeReportLanguage(org?.reportLanguage),
    aiUseRecentSummaries: org ? org.aiUseRecentSummaries : true,
    aiTeacherMustConfirm: org ? org.aiTeacherMustConfirm : true,
    aiRequireEvidence: org?.aiRequireEvidence ?? true,
  };
}

export async function recentSummariesForPrompt(
  db: Db,
  input: {
    enabled: boolean;
    organizationId: string;
    studentId: string;
    courseId: string;
    excludeLessonId: string;
  },
) {
  if (!input.enabled) return [];
  const rows = await db.teachingReport.findMany({
    where: {
      organizationId: input.organizationId,
      studentId: input.studentId,
      summary: { not: "" },
      status: { in: ["CONFIRMED", "PUBLISHED"] },
      lessonSessionId: { not: input.excludeLessonId },
      lessonSession: { organizationId: input.organizationId, courseId: input.courseId },
    },
    orderBy: { lessonSession: { startAt: "desc" } },
    take: 3,
    select: {
      summary: true,
      lessonSession: { select: { startAt: true, course: { select: { name: true } } } },
    },
  });
  return rows.map((row) => ({
    label: `${shanghaiDateKey(row.lessonSession.startAt)} ${row.lessonSession.course.name}`,
    summary: row.summary,
  }));
}

export async function generateAndStoreDraft(
  db: Db,
  scope: {
    organizationId: string;
    lessonSessionId: string;
    studentId: string;
    teachingRecordId: string;
    existingId: string | null;
  },
  generate: () => Promise<GeneratedReport>,
) {
  const draft = await generate();
  const data = {
    summary: draft.summary,
    strengths: draft.strengths,
    issues: draft.issues,
    nextSteps: draft.nextSteps,
    homeworkSummary: draft.homeworkSummary,
    aiModel: draft.aiModel,
    promptVersion: draft.promptVersion,
    status: "DRAFT" as const,
    generatedAt: new Date(),
    revisionNote: null,
  };
  if (scope.existingId) {
    const updated = await db.teachingReport.updateMany({
      where: {
        id: scope.existingId,
        organizationId: scope.organizationId,
        studentId: scope.studentId,
        status: { in: ["DRAFT", "RETURNED"] },
      },
      data,
    });
    if (updated.count !== 1) throw new AiReportError("报告状态已变化，没有覆盖已确认或已发布的内容。");
    return;
  }
  await db.teachingReport.create({
    data: {
      ...data,
      organizationId: scope.organizationId,
      lessonSessionId: scope.lessonSessionId,
      studentId: scope.studentId,
      teachingRecordId: scope.teachingRecordId,
    },
  });
}

const teacherPublishable = ["DRAFT", "CONFIRMED", "RETURNED"] as const;
const ownerReturnable = ["DRAFT", "CONFIRMED", "PUBLISHED"] as const;

function ready(report: { summary: string; strengths: string; issues: string; nextSteps: string }) {
  return Boolean(report.summary && report.strengths && report.issues && report.nextSteps);
}

export async function publishReportByTeacher(
  db: PrismaClient,
  actor: { id: string; organizationId: string; teacherId: string },
  reportId: string,
) {
  const org = await db.organization.findUnique({
    where: { id: actor.organizationId },
    select: { aiTeacherMustConfirm: true, reportLanguage: true, aiUseRecentSummaries: true },
  });
  const mustConfirm = readOrgReportSettings(org).aiTeacherMustConfirm;
  const report = await db.teachingReport.findFirst({
    where: {
      id: reportId,
      organizationId: actor.organizationId,
      status: { in: [...teacherPublishable] },
      lessonSession: { teacherId: actor.teacherId, organizationId: actor.organizationId },
    },
    select: {
      id: true, status: true, studentId: true, summary: true, strengths: true, issues: true, nextSteps: true, confirmedById: true, confirmedAt: true,
      lessonSession: { select: { startAt: true, course: { select: { name: true } } } },
    },
  });
  if (!report) return { ok: false as const, message: "这份报告不能发布，或你无权操作。" };
  if (!ready(report)) return { ok: false as const, message: "概述、表现、问题和建议都需要填写后才能发布。" };

  if (mustConfirm && report.status !== "CONFIRMED") {
    const confirmed = await db.teachingReport.updateMany({
      where: { id: report.id, organizationId: actor.organizationId, status: { in: ["DRAFT", "RETURNED"] } },
      data: { status: "CONFIRMED", confirmedById: actor.id, confirmedAt: new Date() },
    });
    if (confirmed.count !== 1) return { ok: false as const, message: "确认没有完成，请刷新后再试。" };
    return { ok: true as const, message: "报告已确认，家长还看不到。请再发布一次。" };
  }

  const now = new Date();
  const result = await db.$transaction(async (tx) => {
    const published = await tx.teachingReport.updateMany({
      where: {
        id: report.id,
        organizationId: actor.organizationId,
        status: { in: mustConfirm ? ["CONFIRMED"] : [...teacherPublishable] },
      },
      data: {
        status: "PUBLISHED",
        confirmedById: report.confirmedById ?? actor.id,
        confirmedAt: report.confirmedAt ?? now,
        publishedById: actor.id,
        publishedAt: now,
        revision: { increment: 1 },
      },
    });
    if (published.count !== 1) return { ok: false as const, message: "发布没有完成，请刷新后再试。" };
    await tx.reportRead.deleteMany({
      where: { organizationId: actor.organizationId, reportId: report.id },
    });
    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: "REPORT_PUBLISHED",
      targetType: "TeachingReport",
      targetId: report.id,
      detail: "教师发布报告",
    });
    return { ok: true as const, published: true };
  });
  if (result.ok && "published" in result && result.published) {
    await notifyReportPublished({
      organizationId: actor.organizationId,
      reportId: report.id,
      studentId: report.studentId,
      courseName: report.lessonSession.course.name,
      when: report.lessonSession.startAt,
      publishedAt: now,
    });
  }
  return result;
}

export async function publishReportByOwner(
  _db: Db,
  _actor: { id: string; organizationId: string },
  _reportId: string,
) {
  return { ok: false as const, message: "只有授课教师可以发布报告。" };
}

export async function returnReportByOwner(
  db: PrismaClient,
  actor: { id: string; organizationId: string },
  reportId: string,
  reason: string,
) {
  return db.$transaction(async (tx) => {
    const updated = await tx.teachingReport.updateMany({
      where: {
        id: reportId,
        organizationId: actor.organizationId,
        status: { in: [...ownerReturnable] },
      },
      data: { status: "RETURNED", revisionNote: reason },
    });
    if (updated.count !== 1) return { ok: false as const, message: "这份报告不存在，或已经退回。" };
    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: "REPORT_RETURNED",
      targetType: "TeachingReport",
      targetId: reportId,
      detail: "负责人退回报告",
    });
    return { ok: true as const };
  });
}

export async function reportsVisibleToParent(db: Db, actor: { id: string; organizationId: string }) {
  const links = await db.parentStudentLink.findMany({
    where: { organizationId: actor.organizationId, parentUserId: actor.id },
    select: { studentId: true },
  });
  const studentIds = links.map((link) => link.studentId);
  if (studentIds.length === 0) return [];
  return db.teachingReport.findMany({
    where: {
      organizationId: actor.organizationId,
      status: "PUBLISHED",
      studentId: { in: studentIds },
    },
    select: {
      id: true,
      studentId: true,
      summary: true,
      strengths: true,
      issues: true,
      nextSteps: true,
      homeworkSummary: true,
      publishedAt: true,
      student: { select: { name: true } },
      lessonSession: { select: { title: true, startAt: true, teacher: { select: { name: true } } } },
      photos: { select: { id: true }, orderBy: { createdAt: "asc" } },
      replies: { where: { parentUserId: actor.id }, select: { body: true }, take: 1 },
    },
    orderBy: { publishedAt: "desc" },
  });
}
