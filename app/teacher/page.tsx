import Link from "next/link";
import { StatCards } from "@/components/stat-cards";
import { requireRole } from "@/lib/auth";
import { teacherSnapshot } from "@/lib/dashboard";
import { formatDateTime } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";

export default async function TeacherHomePage() {
  const user = await requireRole("TEACHER", "teacher");
  const teacher = await prisma.teacher.findFirst({
    where: { userId: user.id, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  const snapshot = await teacherSnapshot(user.organizationId, teacher?.id ?? null);

  return (
    <section>
      <h1 className="text-[28px] font-semibold tracking-tight">总览</h1>
      <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">只统计分配给当前教师的课次和报告。</p>
      <div className="mt-6">
        <StatCards
          items={[
            { label: "今日课次", value: snapshot.todayLessons, hint: "打开本周课表。", href: "/teacher/schedule" },
            { label: "待填写记录", value: snapshot.pendingRecordCount, hint: snapshot.pendingRecordCount === 0 ? "已结束的课次都已保存记录。" : "已结束但还没有教学记录。下面最多列出 5 节。", href: "/teacher/records" },
            { label: "待确认报告", value: snapshot.pendingReports, hint: "草稿和已退回的报告还需要教师处理。", href: "/teacher/reports" },
          ]}
        />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <h2 className="text-sm font-semibold">待填写的课次</h2>
          {snapshot.pendingRecords.length === 0 ? (
            <p className="mt-4 text-sm leading-7 text-[var(--muted)]">目前没有待填写的已结束课次。</p>
          ) : (
            <ul className="mt-3">
              {snapshot.pendingRecords.map((lesson) => (
                <li key={lesson.id} className="border-b border-[#eef1ee] py-3 text-sm last:border-b-0">
                  <div className="font-bold">{lesson.course.name} · {lesson.title ?? "课次"}</div>
                  <div className="mt-1 text-xs text-[var(--muted)]">{formatDateTime(lesson.startAt)}</div>
                </li>
              ))}
            </ul>
          )}
          <Link href="/teacher/records" className="mt-3 inline-block text-xs font-bold text-[var(--teal)]">去填写记录</Link>
        </div>
        <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <h2 className="text-sm font-semibold">最近已发布报告</h2>
          {snapshot.published.length === 0 ? (
            <p className="mt-4 text-sm leading-7 text-[var(--muted)]">还没有已发布的报告。家长只能看到发布之后的内容。</p>
          ) : (
            <ul className="mt-3">
              {snapshot.published.map((report) => (
                <li key={report.id} className="flex items-center justify-between gap-3 border-b border-[#eef1ee] py-3 last:border-b-0">
                  <div className="min-w-0 text-sm">
                    <div className="font-bold">{report.student.name} · {report.lessonSession.course.name}</div>
                    <div className="mt-1 text-xs text-[var(--muted)]">{report.publishedAt ? formatDateTime(report.publishedAt) : "已发布"} · {report.lessonSession.title ?? "课次"}</div>
                  </div>
                  <Link href={`/teacher/records?lesson=${report.lessonSession.id}&report=${report.id}`} className="shrink-0 text-xs font-bold text-[var(--teal)]">查看报告 →</Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
