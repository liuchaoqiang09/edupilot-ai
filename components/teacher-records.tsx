"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState, useTransition } from "react";
import { publishReport, saveTeachingRecord, updateReport } from "@/app/teacher/records/actions";
import { addReportPhoto, removeReportPhoto } from "@/app/teacher/records/photos";
import { LessonFlow } from "@/components/lesson-flow";
import { reportStatusLabel, type ReportStatusValue } from "@/lib/report-labels";
import { setUnsavedBlocker } from "@/lib/unsaved-guard";

const RECORD_LIMIT = 2000;
const draftKey = (lessonId: string) => `edupilot:teaching-draft:${lessonId}`;

type RecordDraft = {
  lessonContent: string;
  studentPerformance: string;
  difficulties: string;
  homework: string;
  homeworkDueAt: string;
  teacherPrivateNote: string;
};

function readDraft(lessonId: string): RecordDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(lessonId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<RecordDraft>;
    if (!value || typeof value !== "object") return null;
    return {
      lessonContent: String(value.lessonContent ?? ""),
      studentPerformance: String(value.studentPerformance ?? ""),
      difficulties: String(value.difficulties ?? ""),
      homework: String(value.homework ?? ""),
      homeworkDueAt: String(value.homeworkDueAt ?? ""),
      teacherPrivateNote: String(value.teacherPrivateNote ?? ""),
    };
  } catch {
    return null;
  }
}

function writeDraft(lessonId: string, draft: RecordDraft) {
  try {
    localStorage.setItem(draftKey(lessonId), JSON.stringify(draft));
  } catch {
    // Quota or private mode — server save remains the source of truth after 保存.
  }
}

function clearDraft(lessonId: string) {
  try {
    localStorage.removeItem(draftKey(lessonId));
  } catch {
    // ignore
  }
}

function draftFromForm(form: HTMLFormElement): RecordDraft {
  const data = new FormData(form);
  return {
    lessonContent: String(data.get("lessonContent") ?? ""),
    studentPerformance: String(data.get("studentPerformance") ?? ""),
    difficulties: String(data.get("difficulties") ?? ""),
    homework: String(data.get("homework") ?? ""),
    homeworkDueAt: String(data.get("homeworkDueAt") ?? ""),
    teacherPrivateNote: String(data.get("teacherPrivateNote") ?? ""),
  };
}

export type RecordLesson = {
  id: string;
  title: string;
  dateKey: string;
  when: string;
  ended: boolean;
  students: { id: string; name: string; inactive: boolean; archiveReason: string | null }[];
  record: {
    lessonContent: string;
    studentPerformance: string;
    difficulties: string;
    homework: string;
    homeworkDueAt: string;
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
    readText: string;
    parentReply: string;
    photos: { id: string }[];
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
  const [dirty, setDirty] = useState(false);
  const [selectedId, setSelectedId] = useState(lessons.some((lesson) => lesson.id === initialLessonId) ? initialLessonId : lessons[0]?.id ?? "");
  const [studentId, setStudentId] = useState(() => initialStudentId(lessons, initialLessonId, initialReportId));
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<{ name: string; ok: boolean; message: string }[]>([]);
  const selected = lessons.find((lesson) => lesson.id === selectedId) ?? null;
  const student = selected?.students.find((item) => item.id === studentId) ?? selected?.students[0] ?? null;
  const report = selected?.reports.find((item) => item.studentId === student?.id) ?? null;
  const busy = pending || generating;
  const reportLocked = report?.status === "PUBLISHED" || report?.status === "CONFIRMED";

  useEffect(() => {
    if (!dirty) {
      setUnsavedBlocker(null);
      return;
    }
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    setUnsavedBlocker(() => window.confirm("有未保存的内容，确定离开吗？"));
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      setUnsavedBlocker(null);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [dirty]);

  useEffect(() => {
    if (!selectedId) return;
    const form = document.getElementById("lesson-record") as HTMLFormElement | null;
    if (!form) return;
    const local = readDraft(selectedId);
    if (!local) return;
    const server = selected?.record;
    const sameAsServer =
      server &&
      local.lessonContent === (server.lessonContent ?? "") &&
      local.studentPerformance === (server.studentPerformance ?? "") &&
      local.difficulties === (server.difficulties ?? "") &&
      local.homework === (server.homework ?? "") &&
      local.homeworkDueAt === (server.homeworkDueAt ?? "") &&
      local.teacherPrivateNote === (server.teacherPrivateNote ?? "");
    if (sameAsServer) {
      clearDraft(selectedId);
      return;
    }
    for (const [name, value] of Object.entries(local) as [keyof RecordDraft, string][]) {
      const field = form.elements.namedItem(name);
      if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) field.value = value;
    }
    setDirty(true);
    setMessage("已从本机草稿恢复未保存内容。请核对后点保存。");
    // Restore once when the selected lesson form mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function allowLeave() {
    if (!dirty) return true;
    return window.confirm("当前有未保存的内容，切换后会丢失。确定切换吗？");
  }

  function persistLocalDraft(form?: HTMLFormElement | null) {
    if (!selectedId || !form) return;
    writeDraft(selectedId, draftFromForm(form));
  }

  function chooseLesson(id: string) {
    if (id === selectedId) return;
    if (!allowLeave()) return;
    const lesson = lessons.find((item) => item.id === id);
    setSelectedId(id);
    setStudentId(lesson?.students[0]?.id ?? "");
    setMessage("");
    setDirty(false);
  }

  function chooseStudent(id: string) {
    if (id === studentId) return;
    if (!allowLeave()) return;
    setStudentId(id);
    setMessage("");
    setDirty(false);
  }

  function run(task: () => Promise<{ ok: boolean; message?: string }>, options?: { clearLessonDraft?: boolean }) {
    setMessage("");
    setFailed(false);
    startTransition(async () => {
      const result = await task();
      setFailed(!result.ok);
      setMessage(result.ok ? result.message || "已保存。" : result.message || "操作失败。");
      if (result.ok) {
        setDirty(false);
        if (options?.clearLessonDraft && selectedId) clearDraft(selectedId);
        router.refresh();
      }
    });
  }

  async function generateAnalysis() {
    if (!selected || busy) return;
    setGenerating(true);
    setMessage("");
    setResults([]);
    setFailed(false);
    try {
      const response = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId: selected.id }),
      });
      const data = (await response.json().catch(() => null)) as { ok?: boolean; message?: string; results?: { name: string; ok: boolean; message: string }[] } | null;
      const text = typeof data?.message === "string" ? data.message : "生成失败，教学记录已保留。请稍后重试。";
      const rows = Array.isArray(data?.results) ? data.results : [];
      setResults(rows);
      setFailed(!response.ok || data?.ok === false);
      setMessage(text);
      if (response.ok) router.refresh();
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
    const form = event.currentTarget;
    run(() => saveTeachingRecord(selected.id, new FormData(form)), { clearLessonDraft: true });
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
                <option key={lesson.id} value={lesson.id}>{lesson.when} {lesson.title}</option>
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
                <button type="button" onClick={() => chooseStudent(item.id)} className={`flex w-full items-center justify-between gap-2 border-b border-[#eef1ee] px-4 py-3 text-left ${active ? "bg-[#e4f2ee]" : "bg-white"}`}>
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
            {selected ? <LessonFlow lessonId={selected.id} dateKey={selected.dateKey} current="record" /> : null}
            {message ? <p className={`mt-1 text-xs leading-5 ${failed ? "text-[#9a4b24]" : "text-[#4e6c5c]"}`}>{message}</p> : null}
            {results.length > 0 ? (
              <ul className="mt-1 space-y-0.5 text-xs leading-5">
                {results.map((item, index) => (
                  <li key={`${item.name}-${index}`} className={item.ok ? "text-[#34725d]" : "text-[#9a3434]"}>{item.name}：{item.message}</li>
                ))}
              </ul>
            ) : null}
          </div>
          {selected ? (
            <>
              <button type="submit" form="lesson-record" disabled={busy} className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold disabled:opacity-60">{pending ? "正在保存…" : "保存当前记录"}</button>
              <button type="button" disabled={busy || !selected.record} onClick={generateAnalysis} className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold disabled:opacity-60">{generating ? "正在生成…" : "为本节课全部学生生成草稿"}</button>
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
              <form
                id="lesson-record"
                key={`${selected.id}-${selected.record ? "saved" : "new"}`}
                onSubmit={saveRecord}
                onInput={(event) => {
                  setDirty(true);
                  persistLocalDraft(event.currentTarget);
                }}
                className="grid gap-3"
              >
                <p className="text-xs leading-6 text-[var(--muted)]">教学记录按课次保存，这节课的学生共用同一份。内部备注不会进入报告，也不会给家长看。生成时只把本节课文字发给模型，并清洗 HTML 标签，学生姓名会替换成“该同学”。已发布的报告不会被覆盖。断网或刷新时，未保存内容会留在本机草稿。</p>
                {dirty ? <p className="rounded-xl bg-[#fff8ee] px-3 py-2 text-xs font-bold text-[#9a6729]">有未保存的修改。已写入本机草稿；切换课次、侧栏菜单或关闭页面前请先保存。</p> : null}
                <label className="grid gap-1.5 text-xs font-bold">本节课内容<textarea name="lessonContent" rows={3} maxLength={RECORD_LIMIT} defaultValue={selected.record?.lessonContent ?? ""} className={fieldClass} /></label>
                <label className="grid gap-1.5 text-xs font-bold">学生表现<textarea name="studentPerformance" rows={3} maxLength={RECORD_LIMIT} defaultValue={selected.record?.studentPerformance ?? ""} className={fieldClass} /></label>
                <label className="grid gap-1.5 text-xs font-bold">遇到的问题<textarea name="difficulties" rows={3} maxLength={RECORD_LIMIT} defaultValue={selected.record?.difficulties ?? ""} className={fieldClass} /></label>
                <label className="grid gap-1.5 text-xs font-bold">作业
                  <span className="font-medium text-[var(--muted)]">保存后，这节课名单上的家长就能在「作业」里查看详情并提交；教师在「作业批改」里批改。每项最多 {RECORD_LIMIT} 字。</span>
                  <textarea name="homework" rows={2} maxLength={RECORD_LIMIT} defaultValue={selected.record?.homework ?? ""} className={fieldClass} />
                </label>
                <label className="grid gap-1.5 text-xs font-bold">作业截止（可选）
                  <span className="font-medium text-[var(--muted)]">按上海时间。超过截止且未提交或已退回会标「已逾期」。</span>
                  <input type="datetime-local" name="homeworkDueAt" defaultValue={selected.record?.homeworkDueAt ?? ""} className={fieldClass} />
                </label>
                <label className="grid gap-1.5 text-xs font-bold">内部备注
                  <span className="font-medium text-[#9a6729]">仅教师和机构负责人可见，不会写入报告，也不会发给 AI。</span>
                  <textarea name="teacherPrivateNote" rows={2} maxLength={RECORD_LIMIT} defaultValue={selected.record?.teacherPrivateNote ?? ""} className={fieldClass} />
                </label>
              </form>
              {student && report ? (
                <ReportEditor key={`${report.id}-${report.status}-${report.revision}`} report={report} onDirty={() => setDirty(true)} onSave={(formData) => run(() => updateReport(report.id, formData))} />
              ) : student ? (
                <p className="rounded-xl bg-[#fff8ee] px-4 py-3 text-sm leading-7 text-[#9a6729]">还没有{student.name}的报告草稿。先保存这节课的教学记录，再为本节课全部学生生成草稿。已确认或已发布的报告不会被覆盖。</p>
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

function ReportEditor({ report, onSave, onDirty }: { report: RecordLesson["reports"][number]; onSave: (formData: FormData) => void; onDirty: () => void }) {
  const locked = report.status === "PUBLISHED" || report.status === "CONFIRMED";
  return (
    <>
    <form id="student-report" onSubmit={(event) => { event.preventDefault(); onSave(new FormData(event.currentTarget)); }} onInput={() => { if (!locked) onDirty(); }} className="grid gap-3 border-t border-[var(--line)] pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{report.studentName}的报告</h2>
        <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${report.status === "PUBLISHED" ? "bg-[#edf5f1] text-[#34725d]" : report.status === "RETURNED" ? "bg-[#fff0ed] text-[#b94d4d]" : "bg-[#fff2df] text-[#9a6729]"}`}>
          {reportStatusLabel[report.status]}{report.revision > 0 ? ` · 第 ${report.revision} 版` : ""}
        </span>
      </div>
      {report.revisionNote ? <p className="rounded-xl bg-[#fff2df] px-3 py-2 text-xs leading-6 text-[#9a6729]">退回原因：{report.revisionNote}</p> : null}
      {report.readText ? <p className="text-xs leading-6 text-[var(--muted)]">{report.readText}</p> : null}
      {report.parentReply ? <p className="rounded-xl bg-[#f4faf7] px-3 py-2 text-xs leading-6 text-[#36584c]">家长回复：{report.parentReply}</p> : null}
      <label className="grid gap-1.5 text-xs font-bold">本节课概述<textarea name="summary" rows={3} maxLength={RECORD_LIMIT} defaultValue={report.summary} disabled={locked} className={fieldClass} /></label>
      <label className="grid gap-1.5 text-xs font-bold">做得好的方面<textarea name="strengths" rows={2} maxLength={RECORD_LIMIT} defaultValue={report.strengths} disabled={locked} className={fieldClass} /></label>
      <label className="grid gap-1.5 text-xs font-bold">需要改进<textarea name="issues" rows={2} maxLength={RECORD_LIMIT} defaultValue={report.issues} disabled={locked} className={fieldClass} /></label>
      <label className="grid gap-1.5 text-xs font-bold">下一步建议<textarea name="nextSteps" rows={2} maxLength={RECORD_LIMIT} defaultValue={report.nextSteps} disabled={locked} className={fieldClass} /></label>
      <label className="grid gap-1.5 text-xs font-bold">作业建议<textarea name="homeworkSummary" rows={2} maxLength={RECORD_LIMIT} defaultValue={report.homeworkSummary} disabled={locked} className={fieldClass} /></label>
      {locked ? <p className="text-xs text-[var(--muted)]">{report.status === "CONFIRMED" ? "报告已确认。发布后家长才能查看。需要修改时，请负责人退回。" : "已发布的内容不能直接改。负责人退回后才能再编辑并重新发布。"}</p> : null}
    </form>
    <ReportPhotos reportId={report.id} photos={report.photos} locked={report.status === "PUBLISHED"} />
    </>
  );
}

function ReportPhotos({ reportId, photos, locked }: { reportId: string; photos: { id: string }[]; locked: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  function run(task: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const result = await task();
      setFailed(!result.ok);
      setMessage(result.message);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="grid gap-2">
      <h3 className="text-xs font-bold">课堂照片</h3>
      <p className="text-xs leading-5 text-[var(--muted)]">最多 3 张，JPG、PNG 或 WEBP，单张不超过 1.5 MB。发布后家长才能看到，已发布的报告不能再改照片。</p>
      {photos.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {photos.map((photo) => (
            <div key={photo.id} className="w-28">
              <img src={`/api/report-photos/${photo.id}`} alt="课堂照片" className="h-20 w-28 rounded-lg object-cover" />
              {locked ? null : <button type="button" disabled={pending} onClick={() => run(() => removeReportPhoto(photo.id))} className="mt-1 text-[11px] font-bold text-[#9a3434]">去掉</button>}
            </div>
          ))}
        </div>
      ) : null}
      {locked || photos.length >= 3 ? null : (
        <form onSubmit={(event) => { event.preventDefault(); run(() => addReportPhoto(new FormData(event.currentTarget))); }} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="reportId" value={reportId} />
          <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" className="text-xs" />
          <button disabled={pending} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold disabled:opacity-60">{pending ? "请稍候…" : "添加照片"}</button>
        </form>
      )}
      {message ? <p className={`text-xs ${failed ? "text-[#9a3434]" : "text-[#34725d]"}`}>{message}</p> : null}
    </div>
  );
}
