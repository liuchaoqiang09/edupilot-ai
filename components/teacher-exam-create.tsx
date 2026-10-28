"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { createExam } from "@/app/teacher/exams/actions";
import { EXAM_TITLE_LIMIT } from "@/lib/exam";

export function TeacherExamCreate({
  classes,
}: {
  classes: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState("POINTS");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setMessage("");
    setFailed(false);
    startTransition(async () => {
      const result = await createExam(new FormData(form));
      setFailed(!result.ok);
      setMessage(result.message);
      if (result.ok && result.examId) router.push(`/teacher/exams/${result.examId}`);
    });
  }

  if (classes.length === 0) {
    return <p className="rounded-2xl border border-[var(--line)] bg-white px-4 py-8 text-sm text-[var(--muted)]">你还没有负责的在用班级，无法创建考试。</p>;
  }

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-[var(--line)] bg-white p-5 grid gap-3">
      <h2 className="text-base font-semibold">新建考试</h2>
      <label className="grid gap-1.5 text-xs font-bold">
        班级
        <select name="classGroupId" required className="rounded-[10px] border border-[var(--line)] px-3 py-2 text-sm">
          {classes.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1.5 text-xs font-bold">
        考试名称
        <input name="title" required maxLength={EXAM_TITLE_LIMIT} placeholder="如：10 月单元测验" className="rounded-[10px] border border-[var(--line)] px-3 py-2 text-sm" />
      </label>
      <label className="grid gap-1.5 text-xs font-bold">
        考试日期
        <input type="date" name="examDate" required className="rounded-[10px] border border-[var(--line)] px-3 py-2 text-sm" />
      </label>
      <label className="grid gap-1.5 text-xs font-bold">
        计分方式
        <select name="scoreMode" value={mode} onChange={(event) => setMode(event.target.value)} className="rounded-[10px] border border-[var(--line)] px-3 py-2 text-sm">
          <option value="POINTS">分数</option>
          <option value="GRADE">等级</option>
          <option value="PASS_FAIL">合格制</option>
        </select>
      </label>
      {mode === "POINTS" ? (
        <label className="grid gap-1.5 text-xs font-bold">
          满分
          <input name="maxScore" defaultValue="100" inputMode="decimal" className="rounded-[10px] border border-[var(--line)] px-3 py-2 text-sm" />
        </label>
      ) : null}
      {message ? <p className={`text-sm ${failed ? "text-[#9a3434]" : "text-[#34725d]"}`}>{message}</p> : null}
      <button disabled={pending} className="w-fit rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">
        {pending ? "创建中…" : "创建并录入成绩"}
      </button>
    </form>
  );
}
