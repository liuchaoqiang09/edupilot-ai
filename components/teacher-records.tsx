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
  students: { id: string; name: string }[];
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

export function TeacherRecords({ lessons, requireTeacherConfirm }: { lessons: RecordLesson[]; requireTeacherConfirm: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [generating, setGenerating] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selectedId, setSelectedId] = useState(lessons[0]?.id ?? "");
  const [message, setMessage] = useState("");
  const selected = lessons.find((lesson) => lesson.id === selectedId) ?? null;
  const busy = pending || generating;

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
    const formData = new FormData(event.currentTarget);
    run(() => saveTeachingRecord(selected.id, formData));
  }

  return (
    <section>
      <h1 className="text-[28px] font-semibold tracking-tight">教学记录</h1>
      <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">只显示分配给你的课次。内部备注不会进入报告，也不会给家长看。</p>
      {message ? <p className={`mt-4 rounded-xl px-4 py-3 text-xs leading-6 ${failed ? "bg-[#fff4ec] text-[#9a4b24]" : "bg-[#f0f6ee] text-[#4e6c5c]"}`}>{message}</p> : null}
      <div className="mt-6 grid items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
          {lessons.length === 0 ? <p className="px-4 py-10 text-center text-xs leading-6 text-[var(--muted)]">还没有可以填写的课次。</p> : (
            <ul>
              {lessons.map((lesson) => (
                <li key={lesson.id}>
                  <button type="button" onClick={() => { setSelectedId(lesson.id); setMessage(""); }} className={`w-full border-b border-[#eef1ee] px-4 py-3 text-left last:border-b-0 ${selectedId === lesson.id ? "bg-[#e4f2ee]" : "bg-white"}`}>
                    <div className="text-xs font-bold">{lesson.title}</div>
                    <div className="mt-1 text-[11px] text-[var(--muted)]">{lesson.when} · {lesson.record ? "已有记录" : "未填写"}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {selected ? (
          <div className="space-y-4">
            <form key={`${selected.id}-${selected.record ? "saved" : "new"}`} onSubmit={saveRecord} className="rounded-2xl border border-[var(--line)] bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold">{selected.title}</h2>
                <span className="text-xs text-[var(--muted)]">{selected.when}{selected.ended ? "" : " · 课次尚未结束，可先存草稿"}</span>
              </div>
              <p className="mt-2 text-xs text-[var(--muted)]">学生：{selected.students.map((student) => student.name).join("、") || "还没有名单"}</p>
              <div className="mt-4 grid gap-3">
                <label className="grid gap-1.5 text-xs font-bold">本节课内容<textarea name="lessonContent" rows={3} defaultValue={selected.record?.lessonContent ?? ""} className={fieldClass} /></label>
                <label className="grid gap-1.5 text-xs font-bold">学生表现<textarea name="studentPerformance" rows={3} defaultValue={selected.record?.studentPerformance ?? ""} className={fieldClass} /></label>
                <label className="grid gap-1.5 text-xs font-bold">遇到的问题<textarea name="difficulties" rows={3} defaultValue={selected.record?.difficulties ?? ""} className={fieldClass} /></label>
                <label className="grid gap-1.5 text-xs font-bold">作业<textarea name="homework" rows={2} defaultValue={selected.record?.homework ?? ""} className={fieldClass} /></label>
                <label className="grid gap-1.5 text-xs font-bold">内部备注
                  <span className="font-medium text-[#9a6729]">仅教师和机构负责人可见，不会写入报告。</span>
                  <textarea name="teacherPrivateNote" rows={2} defaultValue={selected.record?.teacherPrivateNote ?? ""} className={fieldClass} />
                </label>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button disabled={busy} className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold disabled:opacity-60">{pending ? "正在保存…" : "保存记录"}</button>
                <button type="button" disabled={busy || !selected.record} onClick={generateAnalysis} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">{generating ? "正在生成…" : "生成 AI 分析"}</button>
              </div>
              <p className="mt-3 text-xs leading-6 text-[var(--muted)]">生成时只把本节课文字发给模型，学生姓名会替换成“该同学”，内部备注不会发送。已发布的报告不会被覆盖。</p>
            </form>
            {selected.reports.map((report) => (
              <ReportEditor key={`${report.id}-${report.status}-${report.revision}`} report={report} pending={busy} requireTeacherConfirm={requireTeacherConfirm} onSave={(formData) => run(() => updateReport(report.id, formData))} onPublish={() => run(() => publishReport(report.id))} />
            ))}
          </div>
        ) : <p className="text-sm text-[var(--muted)]">选择一节课开始填写。</p>}
      </div>
    </section>
  );
}

function ReportEditor({
  report,
  pending,
  requireTeacherConfirm,
  onSave,
  onPublish,
}: {
  report: RecordLesson["reports"][number];
  pending: boolean;
  requireTeacherConfirm: boolean;
  onSave: (formData: FormData) => void;
  onPublish: () => void;
}) {
  const locked = report.status === "PUBLISHED" || report.status === "CONFIRMED";
  return (
    <form onSubmit={(event) => { event.preventDefault(); onSave(new FormData(event.currentTarget)); }} className="rounded-2xl border border-[var(--line)] bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{report.studentName}的报告</h3>
        <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${report.status === "PUBLISHED" ? "bg-[#edf5f1] text-[#34725d]" : report.status === "RETURNED" ? "bg-[#fff0ed] text-[#b94d4d]" : "bg-[#fff2df] text-[#9a6729]"}`}>
          {reportStatusLabel[report.status]}{report.revision > 0 ? ` · 第 ${report.revision} 版` : ""}
        </span>
      </div>
      {report.revisionNote ? <p className="mt-3 rounded-xl bg-[#fff2df] px-3 py-2 text-xs leading-6 text-[#9a6729]">退回原因：{report.revisionNote}</p> : null}
      <div className="mt-3 grid gap-3">
        <label className="grid gap-1.5 text-xs font-bold">本节课概述<textarea name="summary" rows={3} defaultValue={report.summary} disabled={locked} className={fieldClass} /></label>
        <label className="grid gap-1.5 text-xs font-bold">做得好的方面<textarea name="strengths" rows={2} defaultValue={report.strengths} disabled={locked} className={fieldClass} /></label>
        <label className="grid gap-1.5 text-xs font-bold">需要改进<textarea name="issues" rows={2} defaultValue={report.issues} disabled={locked} className={fieldClass} /></label>
        <label className="grid gap-1.5 text-xs font-bold">下一步建议<textarea name="nextSteps" rows={2} defaultValue={report.nextSteps} disabled={locked} className={fieldClass} /></label>
        <label className="grid gap-1.5 text-xs font-bold">作业建议<textarea name="homeworkSummary" rows={2} defaultValue={report.homeworkSummary} disabled={locked} className={fieldClass} /></label>
      </div>
      {locked ? <p className="mt-3 text-xs text-[var(--muted)]">{report.status === "CONFIRMED" ? "报告已确认。发布后家长才能查看。需要修改时，请负责人退回。" : "已发布的内容不能直接改。负责人退回后才能再编辑并重新发布。"}</p> : null}
      {report.status === "PUBLISHED" ? null : (
        <div className="mt-4 flex flex-wrap gap-2">
          {locked ? null : <button disabled={pending} className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold disabled:opacity-60">保存修改</button>}
          <button type="button" disabled={pending} onClick={onPublish} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">
            {report.status === "CONFIRMED" ? "发布给家长" : requireTeacherConfirm ? "确认报告" : "确认并发布"}
          </button>
        </div>
      )}
    </form>
  );
}
