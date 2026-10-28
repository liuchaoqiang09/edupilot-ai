"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { saveExam } from "@/app/teacher/exams/actions";
import { EXAM_COMMENT_LIMIT, EXAM_SUMMARY_LIMIT, examScoreModeLabel, examStatusLabel, type ExamScoreModeValue, type ExamStatusValue } from "@/lib/exam";

export type TeacherExamRow = {
  studentId: string;
  studentName: string;
  score: string;
  gradeLabel: string;
  absent: boolean;
  entered: boolean;
  comment: string;
};

export function TeacherExamEditor(props: {
  examId: string;
  title: string;
  meta: string;
  status: ExamStatusValue;
  scoreMode: ExamScoreModeValue;
  maxScore: string | null;
  classSummary: string;
  showAverage: boolean;
  readCount: number;
  rows: TeacherExamRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  function run(publish: boolean, form: HTMLFormElement) {
    setMessage("");
    setFailed(false);
    startTransition(async () => {
      const result = await saveExam(props.examId, new FormData(form), publish);
      setFailed(!result.ok);
      setMessage(result.message);
      if (result.ok) router.refresh();
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const publish = submitter?.name === "publish";
    run(publish, event.currentTarget);
  }

  return (
    <section className="space-y-4">
      <Link href="/teacher/exams" className="text-xs font-bold text-[var(--teal)]">← 返回考试成绩</Link>
      <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">{props.title}</h1>
            <p className="mt-1 text-xs text-[var(--muted)]">{props.meta}</p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${props.status === "PUBLISHED" ? "bg-[#eef6f1] text-[#34725d]" : "bg-[#fff4e5] text-[#9a6729]"}`}>
            {examStatusLabel[props.status]}
          </span>
        </div>
        <p className="mt-3 text-xs leading-6 text-[var(--muted)]">
          计分：{examScoreModeLabel[props.scoreMode]}
          {props.maxScore ? ` · 满分 ${props.maxScore}` : ""}
          {props.status === "PUBLISHED" ? ` · 家长已读 ${props.readCount}` : " · 草稿家长不可见"}
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-xs">
              <thead className="bg-[#fafbf9] text-[10px] tracking-wide text-[#84918e]">
                <tr>
                  <th className="px-4 py-3 font-extrabold">学生</th>
                  <th className="px-4 py-3 font-extrabold">成绩</th>
                  <th className="px-4 py-3 font-extrabold">缺考</th>
                  <th className="px-4 py-3 font-extrabold">个人评语</th>
                </tr>
              </thead>
              <tbody>
                {props.rows.map((row) => (
                  <tr key={row.studentId} className="border-t border-[#eef1ee]">
                    <td className="px-4 py-3 font-bold">
                      {row.studentName}
                      <input type="hidden" name="studentId" value={row.studentId} />
                    </td>
                    <td className="px-4 py-3">
                      {props.scoreMode === "POINTS" ? (
                        <input name={`score:${row.studentId}`} defaultValue={row.score} inputMode="decimal" placeholder="分数" className="w-24 rounded-[10px] border border-[var(--line)] px-2 py-2 text-sm" />
                      ) : props.scoreMode === "PASS_FAIL" ? (
                        <select name={`grade:${row.studentId}`} defaultValue={row.gradeLabel} className="rounded-[10px] border border-[var(--line)] px-2 py-2 text-sm">
                          <option value="">未录入</option>
                          <option value="合格">合格</option>
                          <option value="不合格">不合格</option>
                        </select>
                      ) : (
                        <input name={`grade:${row.studentId}`} defaultValue={row.gradeLabel} maxLength={20} placeholder="如 A / B+" className="w-28 rounded-[10px] border border-[var(--line)] px-2 py-2 text-sm" />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <label className="inline-flex items-center gap-2 font-bold">
                        <input type="checkbox" name={`absent:${row.studentId}`} value="1" defaultChecked={row.absent} />
                        缺考
                      </label>
                    </td>
                    <td className="px-4 py-3">
                      <input name={`comment:${row.studentId}`} defaultValue={row.comment} maxLength={EXAM_COMMENT_LIMIT} placeholder="给家长看的个人总结" className="w-full min-w-[180px] rounded-[10px] border border-[var(--line)] px-2 py-2 text-sm" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--line)] bg-white p-5 grid gap-3">
          <label className="grid gap-1.5 text-xs font-bold">
            班级总结（可选）
            <span className="font-medium text-[var(--muted)]">全体家长可见同一段文字，请勿写个别学生隐私。最多 {EXAM_SUMMARY_LIMIT} 字。</span>
            <textarea name="classSummary" rows={4} maxLength={EXAM_SUMMARY_LIMIT} defaultValue={props.classSummary} className="rounded-[10px] border border-[var(--line)] px-3 py-2 text-sm" />
          </label>
          {props.scoreMode === "POINTS" ? (
            <label className="inline-flex items-center gap-2 text-xs font-bold">
              <input type="checkbox" name="showAverage" value="1" defaultChecked={props.showAverage} />
              发布后向家长展示班级均分（不展示名次和其他人分数）
            </label>
          ) : null}
          {message ? <p className={`text-sm ${failed ? "text-[#9a3434]" : "text-[#34725d]"}`}>{message}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" name="save" disabled={pending} className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold disabled:opacity-60">
              {pending ? "保存中…" : "保存草稿"}
            </button>
            <button type="submit" name="publish" disabled={pending} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">
              {props.status === "PUBLISHED" ? "保存并重新通知家长" : "发布给家长"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
