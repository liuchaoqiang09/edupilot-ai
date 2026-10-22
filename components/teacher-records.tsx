"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";
import { publishReport, saveTeachingRecord, updateReport } from "@/app/teacher/records/actions";
import { reportStatusLabel, type ReportStatusValue } from "@/lib/report-labels";

export type RecordLesson = {
  id: string;
  title: string;
  when: string;
  ended: boolean;
  students: { id: string; name: string; inactive: boolean; archiveReason: string | null }[];
  record: {
    lessonContent: string;
    studentPerformance: string;
    difficulties: string;
    homework: string;
    teacherPrivateNote: string;
  } | null;
  reports: {
    id: string;
    studentId: string;
    studentName: string;
    status: ReportStatusValue;
    summary: string;
    strengths: string;
    issues: string;
    nextSteps: string;
    homeworkSummary: string;
    revisionNote: string | null;
    revision: number;
  }[];
};

const fieldClass = "rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]";

export function TeacherRecords({
  lessons,
  requireTeacherConfirm,
  initialLessonId = "",
  initialReportId = "",
}: {
  lessons: RecordLesson[];
  requireTeacherConfirm: boolean;
  initialLessonId?: string;
  initialReportId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [generating, setGenerating] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selectedId, setSelectedId] = useState(lessons.some((lesson) => lesson.id === initialLessonId) ? initialLessonId : lessons[0]?.id ?? "");
  const [studentId, setStudentId] = useState(() => initialStudentId(lessons, initialLessonId, initialReportId));
  const [message, setMessage] = useState("");
  const selected = lessons.find((lesson) => lesson.id === selectedId) ?? null;
  const student = selected?.students.find((item) => item.id === studentId) ?? selected?.students[0] ?? null;
  const report = selected?.reports.find((item) => item.studentId === student?.id) ?? null;
  const busy = pending || generating;
  const reportLocked = report?.status === "PUBLISHED" || report?.status === "CONFIRMED";

  function chooseLesson(id: string) {
    const lesson = lessons.find((item) => item.id === id);
    setSelectedId(id);
    setStudentId(lesson?.students[0]?.id ?? "");
    setMessage("");
  }

  function run(task: () => Promise<{ ok: boolean; message?: string }>) {
    setMessage("");
    setFailed(false);
    startTransition(async () => {
      const result = await task();
      setFailed(!result.ok);
      setMessage(result.ok ? result.message || "已保存。" : result.message || "操作失败。");
      if (result.ok) router.refresh();
    });
  }

  async function generateAnalysis() {
    if (!selected || busy) return;
    setGenerating(true);
    setMessage("");
    setFailed(false);
    try {
      const response = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId: selected.id }),
      });
      const data = (await response.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      const text = typeof data?.message === "string" ? data.message : "生成失败，教学记录已保留。请稍后重试。";
      if (!response.ok || !data?.ok) {
        setFailed(true);
        setMessage(text);
        if (text.includes("已生成")) router.refresh();
        return;
      }
      setMessage(text);
      router.refresh();
    } catch {
      setFailed(true);
      setMessage("网络异常，教学记录已保留。请稍后重试。");
    } finally {
      setGenerating(false);
    }
  }

  function saveRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    run(() => saveTeachingRecord(selected.id, new FormData(event.currentTarget)));
  }

  return (
    <div className="grid h-[calc(100vh-200px)] min-h-[420px] grid-cols-1 grid-rows-[minmax(180px,1fr)_minmax(0,2fr)] gap-4 lg:grid-cols-4 lg:grid-rows-1">
      <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-white lg:col-span-1">
        <div className="shrink-0 border-b border-[var(--line)] px-4 py-4">
          <div className="text-[11px] font-bold text-[var(--muted)]">当前课次</div>
          {lessons.length === 0 ? (
            <p className="mt-2 text-sm font-semibold">还没有可以填写的课次</p>
          ) : (
            <select value={selected?.id ?? ""} onChange={(event) => chooseLesson(event.target.value)} className="mt-2 w-full rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-sm font-bold outline-none focus:border-[var(--teal)]">
              {lessons.map((lesson) => (
                <option key={lesson.id} value={lesson.id}>{lesson.title}</option>
              ))}
            </select>
          )}
          {selected ? <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{selected.when}{selected.ended ? "" : " · 课次尚未结束，可先存草稿"}</p> : null}
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {selected && selected.students.length === 0 ? <li className="px-4 py-8 text-center text-xs leading-6 text-[var(--muted)]">这节课还没有学生名单。</li> : null}
          {selected?.students.map((item) => {
            const filled = selected.reports.some((entry) => entry.studentId === item.id);
            const active = student?.id === item.id;
            const reason = item.archiveReason?.trim() || "未填写";
            return (
              <li key={item.id}>
                <button type="button" onClick={() => { setStudentId(item.id); setMessage(""); }} className={`flex w-full items-center justify-between gap-2 border-b border-[#eef1ee] px-4 py-3 text-left ${active ? "bg-[#e4f2ee]" : "bg-white"}`}>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">{item.name}</span>
                    {item.inactive ? <span className="mt-1 inline-block rounded-full bg-[#eef1ee] px-2 py-0.5 text-[10px] font-bold text-[#74838b]" title={`停用原因：${reason}`}>已停用</span> : null}
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${filled ? "bg-[#edf5f1] text-[#34725d]" : "bg-[#fff2df] text-[#9a6729]"}`}>{filled ? "已填" : "未填"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-white lg:col-span-3">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--line)] px-5 py-3">
          <div className="mr-auto min-w-0">
            <h1 className="truncate text-base font-semibold">{student ? `${student.name}的记录` : "教学记录"}</h1>
            {message ? <p className={`mt-1 text-xs leading-5 ${failed ? "text-[#9a4b24]" : "text-[#4e6c5c]"}`}>{message}</p> : null}
          </div>
          {selected ? (
            <>
              <button type="submit" form="lesson-record" disabled={busy} className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold disabled:opacity-60">{pending ? "正在保存…" : "保存当前记录"}</button>
              <button type="button" disabled={busy || !selected.record} onClick={generateAnalysis} className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold disabled:opacity-60">{generating ? "正在生成…" : "生成 AI 草稿"}</button>
              {report && !reportLocked ? <button type="submit" form="student-report" disabled={busy} className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold disabled:opacity-60">保存当前报告</button> : null}
              {report && report.status !== "PUBLISHED" ? (
                <button type="button" disabled={busy} onClick={() => run(() => publishReport(report.id))} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">
                  {report.status === "CONFIRMED" ? "发布当前报告" : requireTeacherConfirm ? "确认报告" : "发布当前报告"}
                </button>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {!selected ? <p className="text-sm text-[var(--muted)]">选择一节课开始填写。</p> : (
            <div className="space-y-4">
              <form id="lesson-record" key={`${selected.id}-${selected.record ? "saved" : "new"}`} onSubmit={saveRecord} className="grid gap-3">
                <p className="text-xs leading-6 text-[var(--muted)]">教学记录按课次保存，这节课的学生共用同一份。内部备注不会进入报告，也不会给家长看。生成时只把本节课文字发给模型，学生姓名会替换成“该同学”。已发布的报告不会被覆盖。</p>
                <label className="grid gap-1.5 text-xs font-bold">本节课内容<textarea name="lessonContent" rows={3} defaultValue={selected.record?.lessonContent ?? ""} className={fieldClass} /></label>
                <label className="grid gap-1.5 text-xs font-bold">学生表现<textarea name="studentPerformance" rows={3} defaultValue={selected.record?.studentPerformance ?? ""} className={fieldClass} /></label>
                <label className="grid gap-1.5 text-xs font-bold">遇到的问题<textarea name="difficulties" rows={3} defaultValue={selected.record?.difficulties ?? ""} className={fieldClass} /></label>
                <label className="grid gap-1.5 text-xs font-bold">作业<textarea name="homework" rows={2} defaultValue={selected.record?.homework ?? ""} className={fieldClass} /></label>
                <label className="grid gap-1.5 text-xs font-bold">内部备注
                  <span className="font-medium text-[#9a6729]">仅教师和机构负责人可见，不会写入报告。</span>
                  <textarea name="teacherPrivateNote" rows={2} defaultValue={selected.record?.teacherPrivateNote ?? ""} className={fieldClass} />
                </label>
              </form>
              {student && report ? (
                <ReportEditor key={`${report.id}-${report.status}-${report.revision}`} report={report} onSave={(formData) => run(() => updateReport(report.id, formData))} />
              ) : student ? (
                <p className="rounded-xl bg-[#fff8ee] px-4 py-3 text-sm leading-7 text-[#9a6729]">还没有{student.name}的报告草稿。先保存这节课的教学记录，再生成 AI 草稿。</p>
              ) : (
                <p className="text-sm text-[var(--muted)]">这节课还没有学生，可以先保存教学记录。</p>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function initialStudentId(lessons: RecordLesson[], lessonId: string, reportId: string) {
  const lesson = lessons.find((item) => item.id === lessonId) ?? lessons[0];
  if (!lesson) return "";
  const report = lesson.reports.find((item) => item.id === reportId);
  if (report && lesson.students.some((student) => student.id === report.studentId)) return report.studentId;
  return lesson.students[0]?.id ?? "";
}

function ReportEditor({ report, onSave }: { report: RecordLesson["reports"][number]; onSave: (formData: FormData) => void }) {
  const locked = report.status === "PUBLISHED" || report.status === "CONFIRMED";
  return (
    <form id="student-report" onSubmit={(event) => { event.preventDefault(); onSave(new FormData(event.currentTarget)); }} className="grid gap-3 border-t border-[var(--line)] pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{report.studentName}的报告</h2>
        <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${report.status === "PUBLISHED" ? "bg-[#edf5f1] text-[#34725d]" : report.status === "RETURNED" ? "bg-[#fff0ed] text-[#b94d4d]" : "bg-[#fff2df] text-[#9a6729]"}`}>
          {reportStatusLabel[report.status]}{report.revision > 0 ? ` · 第 ${report.revision} 版` : ""}
        </span>
      </div>
      {report.revisionNote ? <p className="rounded-xl bg-[#fff2df] px-3 py-2 text-xs leading-6 text-[#9a6729]">退回原因：{report.revisionNote}</p> : null}
      <label className="grid gap-1.5 text-xs font-bold">本节课概述<textarea name="summary" rows={3} defaultValue={report.summary} disabled={locked} className={fieldClass} /></label>
      <label className="grid gap-1.5 text-xs font-bold">做得好的方面<textarea name="strengths" rows={2} defaultValue={report.strengths} disabled={locked} className={fieldClass} /></label>
      <label className="grid gap-1.5 text-xs font-bold">需要改进<textarea name="issues" rows={2} defaultValue={report.issues} disabled={locked} className={fieldClass} /></label>
      <label className="grid gap-1.5 text-xs font-bold">下一步建议<textarea name="nextSteps" rows={2} defaultValue={report.nextSteps} disabled={locked} className={fieldClass} /></label>
      <label className="grid gap-1.5 text-xs font-bold">作业建议<textarea name="homeworkSummary" rows={2} defaultValue={report.homeworkSummary} disabled={locked} className={fieldClass} /></label>
      {locked ? <p className="text-xs text-[var(--muted)]">{report.status === "CONFIRMED" ? "报告已确认。发布后家长才能查看。需要修改时，请负责人退回。" : "已发布的内容不能直接改。负责人退回后才能再编辑并重新发布。"}</p> : null}
    </form>
  );
}
