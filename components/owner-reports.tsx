"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";
import { returnReport } from "@/app/owner/reports/actions";
import { Modal } from "@/components/modal";
import { reportStatusLabel, type ReportStatusValue } from "@/lib/report-labels";

export type OwnerReportRow = {
  id: string;
  studentName: string;
  title: string;
  teacherName: string;
  when: string;
  status: ReportStatusValue;
  summary: string;
  revisionNote: string | null;
  privateNote: string | null;
};

export function OwnerReports({ reports, status }: { reports: OwnerReportRow[]; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [returning, setReturning] = useState<OwnerReportRow | null>(null);
  const [message, setMessage] = useState("");
  const filters = [
    { value: "", label: "全部" },
    { value: "DRAFT", label: "草稿" },
    { value: "CONFIRMED", label: "已确认" },
    { value: "PUBLISHED", label: "已发布" },
    { value: "RETURNED", label: "已退回" },
  ];

  function submitReturn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!returning) return;
    const formData = new FormData(event.currentTarget);
    setMessage("");
    startTransition(async () => {
      const result = await returnReport(returning.id, formData);
      if (!result.ok) {
        setMessage(result.message ?? "退回失败。");
        return;
      }
      setReturning(null);
      router.refresh();
    });
  }

  return (
    <section>
      <h1 className="text-[28px] font-semibold tracking-tight">教学报告</h1>
      <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">查看本机构已经生成的报告。退回后教师可以修改并重新发布。</p>
      <form action="/owner/reports" className="mt-5 flex flex-wrap items-center gap-2">
        <select name="status" defaultValue={status} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">
          {filters.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <button className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">筛选</button>
      </form>
      <div className="mt-4 space-y-3">
        {reports.length === 0 ? <p className="rounded-2xl border border-[var(--line)] bg-white px-4 py-12 text-center text-sm text-[var(--muted)]">没有符合条件的报告。</p> : reports.map((report) => (
          <article key={report.id} className="rounded-2xl border border-[var(--line)] bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">{report.studentName} · {report.title}</h2>
                <p className="mt-1 text-xs text-[var(--muted)]">{report.when} · {report.teacherName}</p>
              </div>
              <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${report.status === "PUBLISHED" ? "bg-[#edf5f1] text-[#34725d]" : report.status === "RETURNED" ? "bg-[#fff0ed] text-[#b94d4d]" : "bg-[#fff2df] text-[#9a6729]"}`}>
                {reportStatusLabel[report.status]}
              </span>
            </div>
            <p className="mt-3 text-sm leading-7 text-[var(--muted)]">{report.summary || "还没有概述。"}</p>
            {report.revisionNote ? <p className="mt-2 text-xs leading-6 text-[#9a6729]">退回原因：{report.revisionNote}</p> : null}
            {report.privateNote ? <p className="mt-3 rounded-xl bg-[#f7faf8] px-3 py-2 text-xs leading-6 text-[#4e6c5c]">内部备注（家长不可见）：{report.privateNote}</p> : null}
            {report.status !== "RETURNED" ? (
              <button type="button" onClick={() => { setReturning(report); setMessage(""); }} className="mt-3 text-xs font-bold text-[#9a6729]">退回</button>
            ) : null}
          </article>
        ))}
      </div>
      {returning ? (
        <Modal title="退回报告" onClose={() => setReturning(null)}>
          <form onSubmit={submitReturn} className="px-5 py-5">
            <p className="text-sm">{returning.studentName} · {returning.title}</p>
            <label className="mt-3 grid gap-1.5 text-xs font-bold">
              退回原因 *
              <textarea name="revisionNote" rows={3} required className="rounded-[10px] border border-[var(--line)] px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]" />
            </label>
            {message ? <p className="mt-3 text-xs text-[#b94d4d]">{message}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setReturning(null)} className="rounded-[10px] border border-[var(--line)] px-3.5 py-2.5 text-xs font-bold">取消</button>
              <button disabled={pending} className="rounded-[10px] bg-[#c27b35] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">{pending ? "正在退回…" : "确认退回"}</button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}
