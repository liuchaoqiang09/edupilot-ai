import { ParentChildFilter } from "@/components/parent-child-filter";
import { requireRole } from "@/lib/auth";
import { formatClock, formatDateLabel, shanghaiDateKey } from "@/lib/datetime";
import { linkedParentChildren, parentVisibleLessonFilter, pickLinkedChildId } from "@/lib/parent-scope";
import { prisma } from "@/lib/prisma";

export default async function ParentHomeworkPage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string }>;
}) {
  const user = await requireRole("PARENT", "parent");
  const params = await searchParams;
  const children = await linkedParentChildren(user.organizationId, user.id);
  const studentId = pickLinkedChildId(children, params.student);
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
      student: { select: { name: true } },
      lessonSession: {
        select: {
          title: true,
          startAt: true,
          teacher: { select: { name: true } },
          course: { select: { name: true } },
          teachingRecord: { select: { homework: true, updatedAt: true } },
        },
      },
    },
    orderBy: { lessonSession: { startAt: "desc" } },
    take: 40,
  });
  const homework = rows.flatMap((row) => {
    const text = row.lessonSession.teachingRecord?.homework?.trim() ?? "";
    if (!text) return [];
    return [{ id: row.id, student: row.student.name, course: row.lessonSession.course.name, title: row.lessonSession.title ?? "课次", teacher: row.lessonSession.teacher.name, when: `${formatDateLabel(shanghaiDateKey(row.lessonSession.startAt))} ${formatClock(row.lessonSession.startAt)}`, text }];
  });

  return (
    <section>
      <h1 className="text-[28px] font-semibold tracking-tight">作业</h1>
      <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">教师保存这节课的作业后就会出现在这里，不用等学习报告发布。报告里的作业建议仍只在报告发布后显示。</p>
      <ParentChildFilter basePath="/parent/homework" childrenList={children} selectedId={studentId} />
      <div className="mt-6 space-y-3">
        {homework.length === 0 ? <p className="rounded-2xl border border-[var(--line)] bg-white px-4 py-12 text-center text-sm text-[var(--muted)]">还没有已保存的作业。</p> : homework.map((item) => (
          <article key={item.id} className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white p-5">
            <h2 className="break-words text-base font-semibold">{item.course} · {item.title}</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">{item.student} · {item.teacher} · {item.when}</p>
            <p className="mt-3 overflow-hidden whitespace-pre-wrap break-words rounded-xl bg-[#f7f9f6] px-3 py-3 text-sm leading-7 text-[#42565a]">{item.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
