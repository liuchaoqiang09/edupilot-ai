"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { gradeHomework } from "@/app/teacher/homework/actions";
import {
  HOMEWORK_FEEDBACK_LIMIT,
  HOMEWORK_SCORE_LIMIT,
  homeworkStatusLabel,
  homeworkStatusTone,
  listHomeworkStatus,
  type HomeworkStatusValue,
} from "@/lib/homework";

export type TeacherHomeworkStudent = {
  lessonStudentId: string;
  submissionId: string | null;
  studentName: string;
  status: HomeworkStatusValue | null;
  body: string;
  feedback: string;
  score: string;
  submittedLabel: string | null;
  assets: { id: string; kind: "IMAGE" | "FILE"; fileName: string }[];
};

export function TeacherHomeworkLesson({
  lessonId,
  title,
  when,
  assignment,
  dueLabel,
  students,
}: {
  lessonId: string;
  title: string;
  when: string;
  assignment: string;
  dueLabel: string | null;
  students: TeacherHomeworkStudent[];
}) {
  return (
    <section className="space-y-4">
      <Link href="/teacher/homework" className="text-xs font-bold text-[var(--teal)]">← 返回作业批改</Link>
      <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-xs text-[var(--muted)]">{when}</p>
        {dueLabel ? <p className="mt-2 text-xs font-bold text-[#9a6729]">截止：{dueLabel}</p> : null}
        <h2 className="mt-4 text-sm font-semibold">布置内容</h2>
        <p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-[#f7f9f6] px-3 py-3 text-sm leading-7">{assignment}</p>
        <p className="mt-3 text-xs text-[var(--muted)]">要改作业要求或截止时间，请到「教学记录」里保存。课次编号仅供跳转：{lessonId.slice(-6)}</p>
      </div>
      <div className="space-y-3">
        {students.map((student) => (
          <StudentCard key={student.lessonStudentId} student={student} />
        ))}
      </div>
    </section>
  );
}

function StudentCard({ student }: { student: TeacherHomeworkStudent }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const status = listHomeworkStatus(student.status);

  function run(task: () => Promise<{ ok: boolean; message: string }>) {
    setMessage("");
    setFailed(false);
    startTransition(async () => {
      const result = await task();
      setFailed(!result.ok);
      setMessage(result.message);
      if (result.ok) router.refresh();
    });
  }

  function onAction(form: HTMLFormElement, action: string) {
    if (!student.submissionId) return;
    const formData = new FormData(form);
    formData.set("action", action);
    run(() => gradeHomework(student.submissionId!, formData));
  }

  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{student.studentName}</h2>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${homeworkStatusTone[status]}`}>{homeworkStatusLabel[status]}</span>
      </div>
      {student.submittedLabel ? <p className="mt-1 text-xs text-[var(--muted)]">提交于 {student.submittedLabel}</p> : null}

      {status === "PENDING" ? (
        <p className="mt-3 text-sm text-[var(--muted)]">还没有提交。</p>
      ) : (
        <div className="mt-3 space-y-3">
          {student.body ? <p className="whitespace-pre-wrap break-words rounded-xl bg-[#f7f9f6] px-3 py-3 text-sm leading-7">{student.body}</p> : <p className="text-sm text-[var(--muted)]">没有文字说明。</p>}
          <div className="flex flex-wrap gap-3">
            {student.assets.map((asset) =>
              asset.kind === "IMAGE" ? (
                <a key={asset.id} href={`/api/homework-assets/${asset.id}`} target="_blank" rel="noreferrer">
                  <img src={`/api/homework-assets/${asset.id}`} alt={asset.fileName} className="h-24 w-32 rounded-lg object-cover" />
                </a>
              ) : (
                <a key={asset.id} href={`/api/homework-assets/${asset.id}`} target="_blank" rel="noreferrer" className="flex h-24 w-32 items-center justify-center rounded-lg border border-[var(--line)] bg-[#f7f9f6] px-2 text-center text-xs font-bold text-[var(--teal)]">
                  {asset.fileName}
                </a>
              ),
            )}
          </div>
          <form
            className="grid gap-2 border-t border-[var(--line)] pt-3"
            onSubmit={(event) => {
              event.preventDefault();
              onAction(event.currentTarget, "grade");
            }}
          >
            <label className="grid gap-1 text-xs font-bold">
              分数 / 等级（选填）
              <input name="score" maxLength={HOMEWORK_SCORE_LIMIT} defaultValue={student.score} className="rounded-[10px] border border-[var(--line)] px-3 py-2 text-sm" placeholder="如 90 或 A" />
            </label>
            <label className="grid gap-1 text-xs font-bold">
              评语 <span className="font-medium text-[var(--muted)]">退回时必填</span>
              <textarea name="feedback" rows={3} maxLength={HOMEWORK_FEEDBACK_LIMIT} defaultValue={student.feedback} className="rounded-[10px] border border-[var(--line)] px-3 py-2 text-sm" placeholder="写给学生的反馈" />
            </label>
            {message ? <p className={`text-sm ${failed ? "text-[#9a3434]" : "text-[#34725d]"}`}>{message}</p> : null}
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={pending} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2 text-xs font-bold text-white disabled:opacity-60">保存批改</button>
              <button
                type="button"
                disabled={pending}
                onClick={(event) => {
                  const form = event.currentTarget.form;
                  if (!form) return;
                  onAction(form, "complete");
                }}
                className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2 text-xs font-bold disabled:opacity-60"
              >
                标记完成
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={(event) => {
                  const form = event.currentTarget.form;
                  if (!form) return;
                  onAction(form, "return");
                }}
                className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2 text-xs font-bold text-[#9a3434] disabled:opacity-60"
              >
                退回重做
              </button>
            </div>
          </form>
        </div>
      )}
    </article>
  );
}
