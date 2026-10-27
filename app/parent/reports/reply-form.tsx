"use client";

import { useState, useTransition } from "react";
import { replyToReport } from "@/app/parent/reports/actions";

export function ReportReplyForm({ reportId, initial }: { reportId: string; initial: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  return (
    <form
      className="mt-4 border-t border-[#eef1ee] pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        const body = String(new FormData(event.currentTarget).get("body") ?? "");
        startTransition(async () => setMessage((await replyToReport(reportId, body)).message ?? ""));
      }}
    >
      <label className="grid gap-1.5 text-xs font-bold">回复老师
        <textarea name="body" rows={3} maxLength={300} defaultValue={initial} placeholder="只回复这份点评，不会发到其他家长。" className="rounded-[10px] border border-[var(--line)] px-3 py-2 text-sm font-medium" />
      </label>
      <button disabled={pending} className="mt-2 rounded-[10px] bg-[var(--navy)] px-3 py-2 text-xs font-bold text-white disabled:opacity-60">{pending ? "正在保存…" : initial ? "更新回复" : "发送回复"}</button>
      {message ? <p className="mt-2 text-xs text-[var(--muted)]">{message}</p> : null}
    </form>
  );
}
