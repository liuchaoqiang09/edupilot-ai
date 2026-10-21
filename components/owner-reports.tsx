"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState, useTransition } from "react";
import { publishReport, returnReport } from "@/app/owner/reports/actions";
import { Modal } from "@/components/modal";
import { reportStatusLabel, type ReportStatusValue } from "@/lib/report-labels";

export type OwnerReportRow = {
  id: string;
  studentName: string;
  title: string;
  courseName: string;
  teacherName: string;
  when: string;
  status: ReportStatusValue;
  summary: string;
  strengths: string;
  issues: string;
  nextSteps: string;
  homeworkSummary: string;
  evidence: string;
  revision: number;
  revisionNote: string | null;
  privateNote: string | null;
};

const filters: { value: "" | ReportStatusValue; label: string }[] = [
  { value: "", label: "全部状态" },
  { value: "DRAFT", label: "草稿" },
  { value: "CONFIRMED", label: "已确认" },
  { value: "PUBLISHED", label: "已发布" },
  { value: "RETURNED", label: "已退回" },
];

function statusClass(status: ReportStatusValue) {
  if (status === "PUBLISHED") return "bg-[#edf5f1] text-[#34725d]";
  if (status === "RETURNED") return "bg-[#fff0ed] text-[#b94d4d]";
  return "bg-[#fff2df] text-[#9a6729]";
}

export function OwnerReports({
  reports,
  counts,
}: {
  reports: OwnerReportRow[];
  counts: { generatedThisWeek: number; pending: number; returned: number; published: number };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<"" | ReportStatusValue>("");
  const [selectedId, setSelectedId] = useState(reports[0]?.id ?? "");
  const [returning, setReturning] = useState(false);
  const [message, setMessage] = useState("");

  const visible = useMemo(
    () => reports.filter((report) => !filter || report.status === filter),
    [reports, filter],
  );
  const selected = visible.find((report) => report.id === selectedId) ?? visible[0] ?? null;
  const canPublish = selected ? selected.status !== "PUBLISHED" && Boolean(selected.summary && selected.issues && selected.nextSteps) : false;

  function refresh() {
    router.refresh();
  }

  function submitReturn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const formData = new FormData(event.currentTarget);
    setMessage("");
    startTransition(async () => {
      const result = await returnReport(selected.id, formData);
      if (!result.ok) {
        setMessage(result.message ?? "退回失败。");
        return;
      }
      setReturning(false);
      refresh();
    });
  }

  function publish() {
    if (!selected) return;
    setMessage("");
    startTransition(async () => {
      const result = await publishReport(selected.id);
      setMessage(result.ok ? "" : result.message ?? "发布失败。");
      if (result.ok) refresh();
    });
  }

  return (
    <section>
      <h1 className="text-[28px] font-semibold tracking-tight">AI 教学报告</h1>
      <p className="mt-2 max-w-3xl leading-7 text-[var(--muted)]">查看教师提交的报告。常规报告由教师确认，负责人可以抽查、退回或发布。</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="本周已生成" value={counts.generatedThisWeek} hint="按生成时间统计" />
        <Stat label="待教师确认" value={counts.pending} hint="草稿和已确认、尚未发布" />
        <Stat label="已退回" value={counts.returned} hint="等待教师修改" />
        <Stat label="已发布报告" value={counts.published} hint="家长端可查看" />
      </div>
      <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(280px,0.82fr)_minmax(0,1.2fr)]">
        <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-[#eef1ee] px-4 py-4">
            <div>
              <h2 className="text-sm font-semibold">报告列表</h2>
              <p className="mt-1 text-[11px] text-[var(--muted)]">点击查看分析内容与依据</p>
            </div>
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as "" | ReportStatusValue)}
              className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold"
            >
              {filters.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </div>
          {visible.length === 0 ? <p className="px-4 py-12 text-center text-sm text-[var(--muted)]">没有符合条件的报告。</p> : (
            <div>
              {visible.map((report) => (
                <button
                  key={report.id}
                  type="button"
                  onClick={() => { setSelectedId(report.id); setMessage(""); }}
                  className={`flex w-full items-start gap-3 border-b border-[#eef1ee] px-4 py-4 text-left last:border-b-0 ${selected?.id === report.id ? "bg-[#f4faf7]" : "bg-white"}`}
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#e4f2ee] text-xs font-bold text-[var(--teal)]">{report.studentName.slice(0, 1)}</span>
                  <span className="min-w-0 flex-1">
                    <strong className="block text-xs">{report.studentName} · {report.courseName}</strong>
                    <span className="mt-1 block text-[11px] leading-5 text-[var(--muted)]">{(report.summary || "还没有学习总结。").slice(0, 58)}</span>
                    <span className="mt-2 block text-[10px] text-[var(--muted)]">{report.when}</span>
                  </span>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${statusClass(report.status)}`}>{reportStatusLabel[report.status]}</span>
                </button>
              ))}
            </div>
          )}
        </section>
        <section className="rounded-2xl border border-[var(--line)] bg-white">
          {selected ? (
            <>
              <div className="flex items-start justify-between gap-3 border-b border-[#eef1ee] px-5 py-4">
                <div>
                  <h2 className="text-sm font-semibold">分析详情</h2>
                  <p className="mt-1 text-[11px] text-[var(--muted)]">{selected.studentName} · {selected.courseName}</p>
                </div>
                <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${statusClass(selected.status)}`}>
                  {reportStatusLabel[selected.status]}{selected.revision > 0 ? ` · 第 ${selected.revision} 版` : ""}
                </span>
              </div>
              <div className="px-5 py-5">
                <h3 className="text-base font-semibold">{selected.title}</h3>
                <p className="mt-1 text-xs text-[var(--muted)]">{selected.when} · {selected.teacherName} · {selected.courseName}</p>
                <Block title="本次学习总结" text={selected.summary} />
                <Block title="发现的问题" text={selected.issues} />
                <Block title="下一步教学建议" text={selected.nextSteps || selected.homeworkSummary} extra={selected.nextSteps && selected.homeworkSummary ? selected.homeworkSummary : ""} />
                <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-bold text-[#34725d]">
                  <span className="rounded-full bg-[#edf5f1] px-2 py-1">本次课堂记录</span>
                  {selected.evidence.includes("模型") ? <span className="rounded-full bg-[#edf5f1] px-2 py-1">{selected.evidence}</span> : <span className="rounded-full bg-[#f4f6f5] px-2 py-1 text-[var(--muted)]">{selected.evidence}</span>}
                </div>
                <p className="mt-3 rounded-xl bg-[#f4faf7] px-3 py-3 text-xs leading-6 text-[#36584c]">
                  <strong>AI 分析依据：</strong>{selected.strengths || "本次记录未提供相关信息。"}
                </p>
                {selected.revisionNote ? <p className="mt-3 rounded-xl bg-[#fff2df] px-3 py-2 text-xs leading-6 text-[#9a6729]">退回原因：{selected.revisionNote}</p> : null}
                {selected.privateNote ? <p className="mt-3 rounded-xl bg-[#f7faf8] px-3 py-2 text-xs leading-6 text-[#4e6c5c]">内部备注（家长不可见）：{selected.privateNote}</p> : null}
                {message ? <p className="mt-3 text-xs text-[#b94d4d]">{message}</p> : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  {selected.status !== "RETURNED" ? (
                    <button type="button" onClick={() => { setReturning(true); setMessage(""); }} className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold">退回修改</button>
                  ) : null}
                  {selected.status !== "PUBLISHED" ? (
                    <button type="button" disabled={pending || !canPublish} onClick={publish} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">
                      {pending ? "正在发布…" : "确认发布"}
                    </button>
                  ) : null}
                </div>
              </div>
            </>
          ) : <p className="px-5 py-12 text-center text-sm text-[var(--muted)]">还没有可以查看的报告。</p>}
        </section>
      </div>
      {returning && selected ? (
        <Modal title="退回报告" onClose={() => setReturning(false)}>
          <form onSubmit={submitReturn} className="px-5 py-5">
            <p className="text-sm">{selected.studentName} · {selected.title}</p>
            <label className="mt-3 grid gap-1.5 text-xs font-bold">
              退回原因 <span className="font-medium text-[#9a6729]">必填</span>
              <textarea name="revisionNote" rows={3} required className="rounded-[10px] border border-[var(--line)] px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]" />
            </label>
            {message ? <p className="mt-3 text-xs text-[#b94d4d]">{message}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setReturning(false)} className="rounded-[10px] border border-[var(--line)] px-3.5 py-2.5 text-xs font-bold">取消</button>
              <button disabled={pending} className="rounded-[10px] bg-[#c27b35] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">{pending ? "正在退回…" : "确认退回"}</button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white px-4 py-4">
      <p className="text-[11px] text-[var(--muted)]">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-[11px] text-[var(--muted)]">{hint}</p>
    </article>
  );
}

function Block({ title, text, extra }: { title: string; text: string; extra?: string }) {
  return (
    <div className="mt-4">
      <h4 className="text-xs font-bold">{title}</h4>
      <p className="mt-1 text-sm leading-7 text-[var(--muted)]">{text || "本次记录未提供相关信息。"}</p>
      {extra ? <p className="mt-1 text-sm leading-7 text-[var(--muted)]">作业：{extra}</p> : null}
    </div>
  );
}
