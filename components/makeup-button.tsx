"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { scheduleMakeup } from "@/app/owner/attendance/actions";

export function MakeupButton({
  sourceId,
  lessons,
}: {
  sourceId: string;
  lessons: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => { setOpen(true); setMessage(""); }} className="font-bold text-[var(--teal)]">安排补课</button>
    );
  }

  return (
    <form
      className="grid min-w-[220px] gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setMessage("");
        startTransition(async () => {
          const result = await scheduleMakeup(sourceId, formData);
          setMessage(result.message ?? "");
          if (result.ok) {
            setOpen(false);
            router.refresh();
          }
        });
      }}
    >
      <select name="targetLessonId" required className="rounded-[10px] border border-[var(--line)] bg-white px-2 py-2 text-xs">
        <option value="">选择已有课次</option>
        {lessons.map((lesson) => <option key={lesson.id} value={lesson.id}>{lesson.label}</option>)}
      </select>
      {lessons.length === 0 ? <span className="text-[11px] text-[#9a6729]">这门课没有其他可加入的课次。</span> : null}
      {message ? <span className="text-[11px] text-[#b94d4d]">{message}</span> : null}
      <span className="flex gap-2">
        <button disabled={pending || lessons.length === 0} className="font-bold text-[var(--teal)] disabled:opacity-50">{pending ? "正在安排…" : "确认加入"}</button>
        <button type="button" onClick={() => setOpen(false)} className="font-bold text-[#74838b]">取消</button>
      </span>
    </form>
  );
}
