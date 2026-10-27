"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState, useTransition } from "react";
import { returnReport } from "@/app/owner/reports/actions";
import { dateFlashClass, DayStep, useDateFlash } from "@/components/day-step";
import { DateField, isCalendarDate } from "@/components/date-field";
import { shiftDate } from "@/lib/datetime";
import { Modal } from "@/components/modal";
import { reportStatusLabel, type ReportStatusValue } from "@/lib/report-labels";
import { usePick } from "@/components/locale-provider";

export type OwnerReportRow = {
  id: string;
  studentName: string;
  studentNo: string | null;
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
  reads: { parentName: string; openedAt: string }[];
  parentReply: string;
};

const filters = ["", "待确认", "草稿", "已确认", "已发布", "已退回"] as const;

function statusClass(status: ReportStatusValue) {
  if (status === "PUBLISHED") return "bg-[#edf5f1] text-[#34725d]";
  if (status === "RETURNED") return "bg-[#fff0ed] text-[#b94d4d]";
  return "bg-[#fff2df] text-[#9a6729]";
}

export function OwnerReports({
  reports,
  counts,
  statusFilter = null,
  showAll,
  sort,
  date,
  dateLabel,
  yesterday,
  today,
  query,
  selectedReportId = "",
}: {
  reports: OwnerReportRow[];
  counts: { generatedThisWeek: number; pending: number; returned: number; published: number };
  statusFilter?: (typeof filters)[number] | null;
  showAll: boolean;
  sort: ReportSort;
  date: string;
  dateLabel: string;
  yesterday: string;
  today: string;
  query: string;
  selectedReportId?: string;
}) {
  const router = useRouter();
  const t = usePick();
  const [pending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState(reports[0]?.id ?? "");
  const [returning, setReturning] = useState(false);
  const [message, setMessage] = useState("");
  const [dateText, setDateText] = useState(date);
  const [dateError, setDateError] = useState("");
  const [queryText, setQueryText] = useState(query);
  const selected = reports.find((report) => report.id === selectedId) ?? reports[0] ?? null;
  const dateFlash = useDateFlash(showAll ? "all" : date);
  const steppedDate = shiftDate(showAll ? today : date, -1);
  const reportKey = reports.map((report) => report.id).join("\n");

  useEffect(() => {
    setDateText(date);
    const ids = reportKey.split("\n");
    setSelectedId(ids.includes(selectedReportId) ? selectedReportId : ids[0] ?? "");
  }, [date, showAll, sort, statusFilter, query, reportKey, selectedReportId]);

  useEffect(() => {
    setQueryText(query);
  }, [query]);

  useEffect(() => {
    const trimmed = queryText.trim();
    if (trimmed === query) return;
    const handle = window.setTimeout(() => {
      router.push(reportHref({ date, all: showAll, status: statusFilter, query: trimmed, sort }));
    }, 300);
    return () => window.clearTimeout(handle);
  }, [queryText, query, date, showAll, sort, statusFilter, router]);

  function changeStatus(value: string) {
    router.push(reportHref({ date, all: showAll, status: value, query: queryText, sort }));
  }

  function applyDate(next: string) {
    setDateText(next);
    setDateError("");
    if (isCalendarDate(next) && (showAll || next !== date)) router.push(reportHref({ date: next, status: statusFilter, query: queryText }));
  }

  function viewDate() {
    if (!isCalendarDate(dateText)) {
      setDateError("请输入 YYYY-MM-DD，或点右侧日历选择。");
      return;
    }
    setDateError("");
    router.push(reportHref({ date: dateText, status: statusFilter, query: queryText }));
  }

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

  return (
    <section>
      <h1 className="text-[28px] font-semibold tracking-tight">{t("AI 教学报告", "Reports")}</h1>
      <p className="mt-2 max-w-3xl leading-7 text-[var(--muted)]">{t("按上课日期查看报告。全部会列出每一天的报告，并可以按上课日期排序。可以用姓名或学生编号找到某个人。负责人可以退回并填写原因，发布由授课教师完成。", "Reports follow the lesson date. All lists every day and can be sorted. Search by name or student number. The owner can return a report with a reason. The teacher publishes it.")}</p>
      <p className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-[var(--teal-2)] px-2.5 py-1 font-bold text-[var(--teal)]">
          当前正在查看：{showAll ? `全部报告 · ${sortLabel[sort]}` : dateLabel}{statusFilter ? ` · ${statusFilter === "待确认" ? "待确认（草稿、已确认、已退回）" : statusFilter}` : ""}{query ? ` · 学生「${query}」` : ""}
        </span>
        <Link href={`/owner/reports?date=${today}`} className="font-bold text-[var(--teal)]">重置</Link>
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <DayStep href={reportHref({ date: steppedDate, status: statusFilter, query: queryText })} direction="back" label="再往前一天" />
        <Link href={reportHref({ date: yesterday, status: statusFilter, query: queryText })} className={scopeClass(!showAll && date === yesterday)}>前一天</Link>
        <Link href={reportHref({ date: today, status: statusFilter, query: queryText })} className={scopeClass(!showAll && date === today)}>今天</Link>
        <Link href={reportHref({ all: true, status: statusFilter, query: queryText })} className={scopeClass(showAll)}>全部</Link>
        <DateField value={dateText} onChange={applyDate} className="w-40 rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold" />
        <button type="button" onClick={viewDate} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">查看</button>
        {showAll ? null : <span className={dateFlashClass(dateFlash)}>{dateLabel}</span>}
      </div>
      {dateError ? <p className="mt-2 text-xs text-[#9a6729]">{dateError}</p> : null}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="本周已生成" value={counts.generatedThisWeek} hint="全机构，按生成时间统计" />
        <Stat label="待教师确认" value={counts.pending} hint="全机构里草稿和已确认、尚未发布" />
        <Stat label="已退回" value={counts.returned} hint="全机构，等待教师修改" />
        <Stat label="已发布报告" value={counts.published} hint="全机构，家长端可查看" />
      </div>
      <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(280px,0.82fr)_minmax(0,1.2fr)]">
        <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-[#eef1ee] px-4 py-4">
            <div>
              <h2 className="text-sm font-semibold">报告列表</h2>
              <p className="mt-1 text-[11px] text-[var(--muted)]">点击查看分析内容与依据</p>
            </div>
            <select
              value={statusFilter ?? ""}
              onChange={(event) => changeStatus(event.target.value)}
              className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold"
            >
              {filters.map((item) => <option key={item || "all"} value={item}>{item || "全部状态"}</option>)}
            </select>
          </div>
          <div className="border-b border-[#eef1ee] px-4 py-3">
            <input
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
              placeholder="搜索姓名或学生编号"
              className="w-full rounded-[10px] border border-[var(--line)] px-3 py-2 text-xs font-medium outline-none focus:border-[var(--teal)]"
            />
          </div>
          {showAll ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-[#eef1ee] px-4 py-3">
              {(["default", "asc", "desc"] as const).map((item) => (
                <Link key={item} href={reportHref({ all: true, status: statusFilter, query: queryText, sort: item })} className={scopeClass(sort === item)}>{sortLabel[item]}</Link>
              ))}
              <span className="text-[11px] text-[var(--muted)]">默认和降序都把最近的课放在前面，升序从最早的课开始。</span>
            </div>
          ) : null}
          {reports.length === 0 ? <p className="px-4 py-12 text-center text-sm leading-7 text-[var(--muted)]">{emptyCopy(showAll, query)}</p> : (
            <div>
              {reports.map((report) => (
                <button
                  key={report.id}
                  type="button"
                  onClick={() => { setSelectedId(report.id); setMessage(""); }}
                  className={`flex w-full items-start gap-3 border-b border-[#eef1ee] px-4 py-4 text-left last:border-b-0 ${selected?.id === report.id ? "bg-[#f4faf7]" : "bg-white"}`}
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#e4f2ee] text-xs font-bold text-[var(--teal)]">{report.studentName.slice(0, 1)}</span>
                  <span className="min-w-0 flex-1">
                    <strong className="block text-xs">{report.studentName} · {report.studentNo ?? "无编号"}</strong>
                    <span className="mt-1 block text-[11px] leading-5 text-[var(--muted)]">{report.courseName} · {report.teacherName}</span>
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
                  <p className="mt-1 text-[11px] text-[var(--muted)]">{selected.studentName} · {selected.studentNo ?? "无编号"} · {selected.courseName}</p>
                </div>
                <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${statusClass(selected.status)}`}>
                  {reportStatusLabel[selected.status]}{selected.revision > 0 ? ` · 第 ${selected.revision} 版` : ""}
                </span>
              </div>
              <div className="px-5 py-5">
                <h3 className="text-base font-semibold">{selected.title}</h3>
                <p className="mt-1 text-xs text-[var(--muted)]">{selected.when} · {selected.teacherName} · {selected.courseName}</p>
                {selected.status === "PUBLISHED" ? (
                  selected.reads.length > 0 ? (
                    <p className="mt-3 rounded-xl bg-[#edf5f1] px-3 py-2 text-xs leading-6 text-[#34725d]">已查看。{selected.reads.map((read) => `${read.parentName} 首次打开 ${read.openedAt}`).join("；")}</p>
                  ) : <p className="mt-3 rounded-xl bg-[#fff2df] px-3 py-2 text-xs leading-6 text-[#9a6729]">未查看。家长还没有打开这份已发布报告。</p>
                ) : <p className="mt-3 rounded-xl bg-[#f7faf8] px-3 py-2 text-xs leading-6 text-[var(--muted)]">未查看。报告发布后，才会记录家长第一次打开的时间。</p>}
                {selected.parentReply ? <p className="mt-3 whitespace-pre-wrap rounded-xl bg-[#f4faf7] px-3 py-2 text-xs leading-6 text-[#36584c]">家长回复：{selected.parentReply}</p> : null}
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

type ReportSort = "default" | "asc" | "desc";

const sortLabel = {
  default: "默认",
  asc: "升序",
  desc: "降序",
} as const;

function reportHref({
  date,
  all = false,
  status,
  query,
  sort = "default",
}: {
  date?: string;
  all?: boolean;
  status?: string | null;
  query?: string;
  sort?: ReportSort;
}) {
  const params = new URLSearchParams();
  if (all) {
    params.set("all", "1");
    if (sort === "asc" || sort === "desc") params.set("sort", sort);
  } else if (date) {
    params.set("date", date);
  }
  if (status) params.set("status", status);
  const trimmed = query?.trim();
  if (trimmed) params.set("q", trimmed);
  const text = params.toString();
  return text ? `/owner/reports?${text}` : "/owner/reports";
}

function scopeClass(active: boolean) {
  return active
    ? "rounded-[10px] bg-[var(--teal)] px-3 py-2 text-xs font-bold text-white"
    : "rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold";
}

function emptyCopy(showAll: boolean, query: string) {
  if (query) return showAll ? `没有姓名或编号匹配「${query}」的报告。` : `这一天没有姓名或编号匹配「${query}」的报告。`;
  return showAll ? "还没有教学报告。" : "这一天还没有教学报告。可以用前一天或日历查看其他日期。";
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
