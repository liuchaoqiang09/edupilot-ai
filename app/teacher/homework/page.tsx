import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { formatClock, formatDateLabel, formatDateTime, shanghaiDateKey } from "@/lib/datetime";
import { homeworkStatusLabel } from "@/lib/homework";
import { prisma } from "@/lib/prisma";

export default async function TeacherHomeworkPage() {
  const user = await requireRole("TEACHER", "teacher");
  const teacher = await prisma.teacher.findFirst({
    where: { userId: user.id, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  const lessons = teacher
    ? await prisma.lessonSession.findMany({
        where: {
          organizationId: user.organizationId,
          teacherId: teacher.id,
          status: { not: "CANCELLED" },
          teachingRecord: { is: { homework: { not: "" } } },
        },
        select: {
          id: true,
          title: true,
          startAt: true,
          course: { select: { name: true } },
          teachingRecord: { select: { homeworkDueAt: true } },
          students: {
            select: { studentId: true, student: { select: { status: true } } },
          },
          homeworkSubmissions: {
            select: { status: true, studentId: true },
          },
        },
        orderBy: { startAt: "desc" },
        take: 40,
      })
    : [];

  return (
    <section>
      <h1 className="text-[28px] font-semibold tracking-tight">作业批改</h1>
      <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">这里列出你已布置作业的课次。家长提交后可批改、标记完成或退回重做。布置内容请在「教学记录」里填写。</p>
      <div className="mt-6 space-y-3">
        {lessons.length === 0 ? (
          <p className="rounded-2xl border border-[var(--line)] bg-white px-4 py-12 text-center text-sm text-[var(--muted)]">还没有布置作业的课次。先到教学记录里写作业并保存。</p>
        ) : lessons.map((lesson) => {
          const rosterIds = new Set(lesson.students.map((row) => row.studentId));
          const total = lesson.students.length;
          const onRoster = lesson.homeworkSubmissions.filter((row) => rosterIds.has(row.studentId));
          const submitted = onRoster.filter((row) => row.status === "SUBMITTED").length;
          const done = onRoster.filter((row) => row.status === "GRADED" || row.status === "COMPLETED").length;
          const returned = onRoster.filter((row) => row.status === "RETURNED").length;
          const pending = Math.max(0, total - onRoster.length);
          return (
            <article key={lesson.id} className="rounded-2xl border border-[var(--line)] bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">{lesson.course.name} · {lesson.title ?? "课次"}</h2>
                  <p className="mt-1 text-xs text-[var(--muted)]">{formatDateLabel(shanghaiDateKey(lesson.startAt))} {formatClock(lesson.startAt)}{lesson.teachingRecord?.homeworkDueAt ? ` · 截止 ${formatDateTime(lesson.teachingRecord.homeworkDueAt)}` : ""}</p>
                </div>
                <Link href={`/teacher/homework/${lesson.id}`} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold text-[var(--teal)]">打开批改</Link>
              </div>
              <p className="mt-3 text-xs leading-6 text-[var(--muted)]">
                名单 {total} 人 · 未交 {pending} · {homeworkStatusLabel.SUBMITTED} {submitted} · 已退回 {returned} · 已批改/完成 {done}
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
