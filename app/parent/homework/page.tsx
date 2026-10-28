import Link from "next/link";
import { ParentChildFilter } from "@/components/parent-child-filter";
import { ParentTimeOrder, parseTimeOrder } from "@/components/parent-time-order";
import { requireRole } from "@/lib/auth";
import { formatClock, formatDateLabel, formatDateTime, shanghaiDateKey } from "@/lib/datetime";
import {
  homeworkOverdue,
  homeworkStatusLabel,
  homeworkStatusTone,
  listHomeworkStatus,
} from "@/lib/homework";
import { linkedParentChildren, parentVisibleLessonFilter, pickLinkedChildId } from "@/lib/parent-scope";
import { prisma } from "@/lib/prisma";

export default async function ParentHomeworkPage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string; order?: string }>;
}) {
  const user = await requireRole("PARENT", "parent");
  const params = await searchParams;
  const children = await linkedParentChildren(user.organizationId, user.id);
  const studentId = pickLinkedChildId(children, params.student);
  const order = parseTimeOrder(params.order);
  const studentIds = studentId ? [studentId] : children.map((child) => child.id);
  const rows = studentIds.length === 0 ? [] : await prisma.lessonStudent.findMany({
    where: {
      organizationId: user.organizationId,
      studentId: { in: studentIds },
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
          teachingRecord: { select: { homework: true, homeworkDueAt: true, updatedAt: true } },
          homeworkSubmissions: {
            where: { studentId: { in: studentIds } },
            select: { studentId: true, status: true, submittedAt: true },
          },
        },
      },
    },
    orderBy: { lessonSession: { startAt: order } },
    take: 40,
  });

  const homework = rows.flatMap((row) => {
    const text = row.lessonSession.teachingRecord?.homework?.trim() ?? "";
    if (!text) return [];
    const submission = row.lessonSession.homeworkSubmissions.find((item) => item.studentId === row.studentId) ?? null;
    const status = listHomeworkStatus(submission?.status);
    const dueAt = row.lessonSession.teachingRecord?.homeworkDueAt ?? null;
    const preview = text.length > 72 ? `${text.slice(0, 72)}…` : text;
    return [{
      id: row.id,
      student: row.student.name,
      course: row.lessonSession.course.name,
      title: row.lessonSession.title ?? "课次",
      teacher: row.lessonSession.teacher.name,
      when: `${formatDateLabel(shanghaiDateKey(row.lessonSession.startAt))} ${formatClock(row.lessonSession.startAt)}`,
      preview,
      status,
      overdue: homeworkOverdue(dueAt, status),
      dueLabel: dueAt ? formatDateTime(dueAt) : null,
      submittedLabel: submission?.submittedAt ? formatDateTime(submission.submittedAt) : null,
    }];
  });

  return (
    <section>
      <h1 className="text-[28px] font-semibold tracking-tight">作业</h1>
      <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">教师保存作业要求后会出现在这里。点「查看详情」可看全文、提交文字/照片/附件，并查看批改结果。报告里的作业建议仍只在报告发布后显示。</p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <ParentChildFilter
          basePath="/parent/homework"
          childrenList={children}
          selectedId={studentId}
          extraParams={order === "asc" ? { order: "asc" } : {}}
          className="flex flex-wrap items-center gap-2"
        />
        <ParentTimeOrder
          basePath="/parent/homework"
          order={order}
          extraParams={studentId ? { student: studentId } : {}}
        />
      </div>
      <div className="mt-6 space-y-3">
        {homework.length === 0 ? (
          <p className="rounded-2xl border border-[var(--line)] bg-white px-4 py-12 text-center text-sm text-[var(--muted)]">还没有已保存的作业。</p>
        ) : homework.map((item) => (
          <article key={item.id} className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="break-words text-base font-semibold">{item.course} · {item.title}</h2>
                <p className="mt-1 text-xs text-[var(--muted)]">{item.student} · {item.teacher} · {item.when}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${homeworkStatusTone[item.status]}`}>{homeworkStatusLabel[item.status]}</span>
                {item.overdue ? <span className="rounded-full bg-[#fdecec] px-2.5 py-1 text-[11px] font-bold text-[#9a3434]">已逾期</span> : null}
              </div>
            </div>
            <p className="mt-3 overflow-hidden whitespace-pre-wrap break-words rounded-xl bg-[#f7f9f6] px-3 py-3 text-sm leading-7 text-[#42565a]">{item.preview}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
              {item.dueLabel ? <span>截止 {item.dueLabel}</span> : null}
              {item.submittedLabel ? <span>提交于 {item.submittedLabel}</span> : null}
              <Link href={`/parent/homework/${item.id}`} className="font-bold text-[var(--teal)]">查看详情</Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
