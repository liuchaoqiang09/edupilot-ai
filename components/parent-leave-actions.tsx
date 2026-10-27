"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelParentLeave, requestParentLeave } from "@/app/parent/schedule/actions";

export function ParentLeaveRequest({ lessonStudentId }: { lessonStudentId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  return (
    <form
      className="mt-2 grid justify-items-start gap-1 sm:justify-items-end"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await requestParentLeave(data);
          setFailed(!result.ok);
          setMessage(result.message);
          if (result.ok) router.refresh();
        });
      }}
    >
      <input type="hidden" name="lessonStudentId" value={lessonStudentId} />
      <input name="note" maxLength={80} placeholder="原因，可选" className="w-28 rounded-[8px] border border-[var(--line)] px-2 py-1 text-[11px]" />
      <button disabled={pending} className="text-[11px] font-bold text-[var(--teal)] disabled:opacity-60">{pending ? "提交中…" : "请假"}</button>
      {message ? <p className={`max-w-[180px] text-[10px] leading-4 ${failed ? "text-[#b94d4d]" : "text-[#34725d]"}`}>{message}</p> : null}
    </form>
  );
}

export function ParentLeaveCancel({ lessonStudentId }: { lessonStudentId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  return (
    <div className="mt-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          const data = new FormData();
          data.set("lessonStudentId", lessonStudentId);
          startTransition(async () => {
            const result = await cancelParentLeave(data);
            setFailed(!result.ok);
            setMessage(result.message);
            if (result.ok) router.refresh();
          });
        }}
        className="text-[11px] font-bold text-[var(--teal)] disabled:opacity-60"
      >
        {pending ? "处理中…" : "取消请假"}
      </button>
      {message ? <p className={`mt-1 max-w-[180px] text-[10px] leading-4 ${failed ? "text-[#b94d4d]" : "text-[#34725d]"}`}>{message}</p> : null}
    </div>
  );
}
