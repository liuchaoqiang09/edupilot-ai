import { notFound } from "next/navigation";
import { ParentHomeworkDetail } from "@/components/parent-homework-detail";
import { requireRole } from "@/lib/auth";
import { formatClock, formatDateLabel, formatDateTime, shanghaiDateKey } from "@/lib/datetime";
import { linkedParentChildren, parentVisibleLessonFilter } from "@/lib/parent-scope";
import { prisma } from "@/lib/prisma";

export default async function ParentHomeworkDetailPage({
  params,
}: {
  params: Promise<{ lessonStudentId: string }>;
}) {
  const user = await requireRole("PARENT", "parent");
  const { lessonStudentId } = await params;
  const children = await linkedParentChildren(user.organizationId, user.id);
  const childIds = new Set(children.map((child) => child.id));
  const row = await prisma.lessonStudent.findFirst({
    where: {
      id: lessonStudentId,
      organizationId: user.organizationId,
      studentId: { in: [...childIds] },
      ...parentVisibleLessonFilter(),
      lessonSession: { status: { not: "CANCELLED" }, teachingRecord: { is: { homework: { not: "" } } } },
    },
    select: {
      id: true,
      studentId: true,
      student: { select: { name: true } },
      lessonSession: {
        select: {
          id: true,
          title: true,
          startAt: true,
          teacher: { select: { name: true } },
          course: { select: { name: true } },
          teachingRecord: { select: { homework: true, homeworkDueAt: true } },
          homeworkSubmissions: {
            where: { studentId: { in: [...childIds] } },
            select: {
              studentId: true,
              body: true,
              status: true,
              feedback: true,
              score: true,
              submittedAt: true,
              gradedAt: true,
              assets: { select: { id: true, kind: true, fileName: true }, orderBy: { createdAt: "asc" } },
            },
          },
        },
      },
    },
  });
  if (!row) notFound();
  const assignment = row.lessonSession.teachingRecord?.homework?.trim() ?? "";
  if (!assignment) notFound();
  const submission = row.lessonSession.homeworkSubmissions.find((item) => item.studentId === row.studentId) ?? null;
  const dueAt = row.lessonSession.teachingRecord?.homeworkDueAt ?? null;

  return (
    <ParentHomeworkDetail
      lessonStudentId={row.id}
      studentName={row.student.name}
      courseName={row.lessonSession.course.name}
      lessonTitle={row.lessonSession.title ?? "课次"}
      when={`${formatDateLabel(shanghaiDateKey(row.lessonSession.startAt))} ${formatClock(row.lessonSession.startAt)}`}
      teacherName={row.lessonSession.teacher.name}
      assignment={assignment}
      dueLabel={dueAt ? formatDateTime(dueAt) : null}
      dueAtIso={dueAt ? dueAt.toISOString() : null}
      status={submission?.status ?? null}
      body={submission?.body ?? ""}
      feedback={submission?.feedback ?? null}
      score={submission?.score ?? null}
      submittedLabel={submission?.submittedAt ? formatDateTime(submission.submittedAt) : null}
      gradedLabel={submission?.gradedAt ? `批改于 ${formatDateTime(submission.gradedAt)}` : null}
      assets={(submission?.assets ?? []).map((asset) => ({ id: asset.id, kind: asset.kind, fileName: asset.fileName }))}
    />
  );
}
