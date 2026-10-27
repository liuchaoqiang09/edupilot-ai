"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { convertAbsentToLeaveForMakeup, scheduleMakeup } from "@/app/owner/attendance/actions";

export function ConvertAbsentButton({
  sourceId,
  lessons,
}: {
  sourceId: string;
  lessons: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [step, setStep] = useState<"idle" | "kind" | "makeup">("idle");
  const [kind, setKind] = useState<"PERSONAL" | "SICK">("SICK");
  const [activeSourceId, setActiveSourceId] = useState(sourceId);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  if (step === "idle") {
    return (
      <button type="button" onClick={() => { setStep("kind"); setMessage(""); setKind("SICK"); }} className="font-bold text-[var(--teal)]">
        转为请假并补课
      </button>
    );
  }

  if (step === "kind") {
    return (
      <div className="grid min-w-[220px] gap-2">
        <p className="text-[11px] leading-5 text-[var(--muted)]">选择请假类型（默认病假）。确认后会退回已扣课时（若有），再选补课课次。</p>
        <select value={kind} onChange={(event) => setKind(event.target.value as "PERSONAL" | "SICK")} className="rounded-[10px] border border-[var(--line)] bg-white px-2 py-2 text-xs">
          <option value="SICK">病假</option>
          <option value="PERSONAL">事假</option>
        </select>
        {message ? <span className="text-[11px] text-[#b94d4d]">{message}</span> : null}
        <span className="flex gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              const data = new FormData();
              data.set("leaveKind", kind);
              setMessage("");
              startTransition(async () => {
                const result = await convertAbsentToLeaveForMakeup(sourceId, data);
                setMessage(result.message ?? "");
                if (result.ok && result.sourceId) {
                  setActiveSourceId(result.sourceId);
                  setStep("makeup");
                  router.refresh();
                }
              });
            }}
            className="font-bold text-[var(--teal)] disabled:opacity-50"
          >
            {pending ? "处理中…" : "确认"}
          </button>
          <button type="button" onClick={() => setStep("idle")} className="font-bold text-[#74838b]">取消</button>
        </span>
      </div>
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
          const result = await scheduleMakeup(activeSourceId, formData);
          setMessage(result.message ?? "");
          if (result.ok) {
            setStep("idle");
            router.refresh();
          }
        });
      }}
    >
      <p className="text-[11px] font-bold text-[#34725d]">已转为请假，请选择补课课次。</p>
      <select name="targetLessonId" required className="rounded-[10px] border border-[var(--line)] bg-white px-2 py-2 text-xs">
        <option value="">选择已有课次</option>
        {lessons.map((lesson) => <option key={lesson.id} value={lesson.id}>{lesson.label}</option>)}
      </select>
      {lessons.length === 0 ? <span className="text-[11px] text-[#9a6729]">这门课没有其他可加入的课次。</span> : null}
      {message ? <span className="text-[11px] text-[#b94d4d]">{message}</span> : null}
      <span className="flex gap-2">
        <button disabled={pending || lessons.length === 0} className="font-bold text-[var(--teal)] disabled:opacity-50">{pending ? "正在安排…" : "确认加入"}</button>
        <button type="button" onClick={() => setStep("idle")} className="font-bold text-[#74838b]">稍后</button>
      </span>
    </form>
  );
}
