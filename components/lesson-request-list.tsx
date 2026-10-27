"use client";

import { useState, useTransition } from "react";
import { decideLessonRequest } from "@/app/owner/schedule/actions";

export function LessonRequestList({
  rows,
}: {
  rows: { id: string; title: string; detail: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-[#edf0ee] px-5 py-4">
        <h2 className="text-sm font-semibold">调课和代课申请</h2>
        <span className="rounded-full bg-[#fff2df] px-2 py-1 text-[10px] font-bold text-[#9a6729]">{rows.length}</span>
      </div>
      {rows.length === 0 ? <p className="px-5 py-8 text-sm text-[var(--muted)]">没有待同意的调课或代课。教师直接改不会生效。</p> : (
        <ul>
          {rows.map((row) => (
            <li key={row.id} className="border-t border-[#eef1ee] px-5 py-3 text-xs">
              <strong className="block">{row.title}</strong>
              <span className="mt-1 block text-[var(--muted)]">{row.detail}</span>
              <span className="mt-2 flex gap-3">
                <button type="button" disabled={pending} onClick={() => startTransition(async () => setMessage((await decideLessonRequest(row.id, "APPROVED")).message ?? ""))} className="font-bold text-[var(--teal)]">同意</button>
                <button type="button" disabled={pending} onClick={() => startTransition(async () => setMessage((await decideLessonRequest(row.id, "REJECTED")).message ?? ""))} className="font-bold text-[#b94d4d]">拒绝</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {message ? <p className="px-5 pb-4 text-xs text-[var(--muted)]">{message}</p> : null}
    </section>
  );
}
