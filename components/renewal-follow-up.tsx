"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { recordRenewalFollowUp } from "@/app/owner/attendance/actions";

export function RenewalFollowUpForm({ studentId, courseId, startOpen = false }: { studentId: string; courseId: string; startOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(startOpen);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="ml-3 font-bold text-[var(--teal)]">跟进</button>;
  }
  return (
    <form
      className="mt-2 grid gap-2 rounded-xl border border-[var(--line)] bg-[#f7faf8] p-2"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await recordRenewalFollowUp(studentId, courseId, formData);
          setMessage(result.message ?? "");
          if (result.ok) {
            setOpen(false);
            router.refresh();
          }
        });
      }}
    >
      <select name="outcome" required className="rounded-[10px] border border-[var(--line)] bg-white px-2 py-2 text-xs">
        <option value="TO_CONTACT">待联系</option>
        <option value="CONTACTED">已联系</option>
        <option value="NEXT_BOOKED">已约下次</option>
        <option value="DECLINED">已拒绝</option>
      </select>
      <input name="note" maxLength={200} placeholder="备注" className="rounded-[10px] border border-[var(--line)] bg-white px-2 py-2 text-xs" />
      <input name="nextContactOn" type="date" className="rounded-[10px] border border-[var(--line)] bg-white px-2 py-2 text-xs" />
      {message ? <span className="text-[11px] text-[#b94d4d]">{message}</span> : null}
      <span className="flex gap-2">
        <button disabled={pending} className="font-bold text-[var(--teal)]">{pending ? "正在保存…" : "保存跟进"}</button>
        <button type="button" onClick={() => setOpen(false)} className="font-bold text-[#74838b]">取消</button>
      </span>
    </form>
  );
}
