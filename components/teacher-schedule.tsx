"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";
import { saveAttendance } from "@/app/teacher/actions";
import { Modal } from "@/components/modal";
import { attendanceLabel, attendanceOptions, lessonStatusLabel } from "@/lib/lesson-labels";

export type TeacherLesson = {
  id: string;
  title: string;
  startLabel: string;
  endLabel: string;
  location: string | null;
  status: keyof typeof lessonStatusLabel;
  students: { id: string; name: string; attendanceStatus: keyof typeof attendanceLabel; attendanceNote: string | null }[];
};

export function TeacherSchedule({
  date,
  previousDate,
  nextDate,
  dateLabel,
  linked,
  lessons,
}: {
  date: string;
  previousDate: string;
  nextDate: string;
  dateLabel: string;
  linked: boolean;
  lessons: TeacherLesson[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [marking, setMarking] = useState<TeacherLesson | null>(null);
  const [message, setMessage] = useState("");

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!marking) return;
    const formData = new FormData(event.currentTarget);
    setMessage("");
    startTransition(async () => {
      const result = await saveAttendance(marking.id, formData);
      if (!result.ok) {
        setMessage(result.message ?? "保存失败。");
        return;
      }
      setMarking(null);
      router.refresh();
    });
  }

  return (
    <section>
      <h1 className="text-[28px] font-semibold tracking-tight">我的课表</h1>
      <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">只显示分配给当前教师档案的课次。点开一节课即可记录出勤。</p>

      {!linked ? (
        <p className="mt-4 rounded-xl bg-[#fff2df] px-4 py-3 text-xs leading-6 text-[#9a6729]">
          当前登录账号还没有关联教师档案。请让机构负责人在「教师管理」里，把这个账号关联到对应教师。
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Link href={`/teacher?date=${previousDate}`} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">前一天</Link>
        <form action="/teacher" className="flex items-center gap-2">
          <input type="date" name="date" defaultValue={date} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold" />
          <button className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">查看</button>
        </form>
        <Link href={`/teacher?date=${nextDate}`} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">后一天</Link>
        <span className="text-xs text-[var(--muted)]">{dateLabel}</span>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        {lessons.length === 0 ? (
          <p className="px-5 py-12 text-center leading-7 text-[var(--muted)]">这一天没有分配给你的课次。</p>
        ) : (
          <ul className="px-5">
            {lessons.map((lesson) => (
              <li key={lesson.id} className="grid grid-cols-[64px_4px_minmax(0,1fr)_auto] items-center gap-3 border-b border-[#f0f2f0] py-4 last:border-b-0">
                <div className="text-xs font-extrabold">
                  {lesson.startLabel}
                  <small className="mt-1 block font-medium text-[var(--muted)]">{lesson.endLabel}</small>
                </div>
                <div className="h-10 w-1 rounded bg-[#91c8b5]" />
                <div>
                  <div className="text-xs font-bold">{lesson.title}</div>
                  <div className="mt-1 text-[11px] text-[var(--muted)]">{lesson.students.length} 人 · {lesson.location ?? "地点待定"}</div>
                </div>
                <button type="button" onClick={() => { setMarking(lesson); setMessage(""); }} className="text-xs font-bold text-[var(--teal)]">
                  {lesson.status === "CANCELLED" ? "查看" : "记录考勤"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {marking ? (
        <Modal title={marking.status === "CANCELLED" ? "课次已取消" : "记录考勤"} onClose={() => setMarking(null)}>
          <form onSubmit={save} className="px-5 py-5">
            <p className="text-sm font-bold">{marking.title}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">{marking.startLabel} – {marking.endLabel}</p>
            {marking.students.length === 0 ? <p className="mt-4 text-sm text-[var(--muted)]">这节课没有学生名单。</p> : (
              <ul className="mt-4 space-y-3">
                {marking.students.map((student) => (
                  <li key={student.id} className="rounded-xl border border-[var(--line)] p-3">
                    <div className="text-sm font-bold">{student.name}</div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <select name={`status:${student.id}`} defaultValue={student.attendanceStatus} disabled={marking.status === "CANCELLED"} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-sm">
                        {attendanceOptions.map((status) => (
                          <option key={status} value={status}>{attendanceLabel[status]}</option>
                        ))}
                      </select>
                      <input name={`note:${student.id}`} defaultValue={student.attendanceNote ?? ""} placeholder="备注，选填" disabled={marking.status === "CANCELLED"} className="rounded-[10px] border border-[var(--line)] px-3 py-2 text-sm outline-none focus:border-[var(--teal)]" />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {message ? <p className="mt-3 text-xs text-[#b94d4d]">{message}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setMarking(null)} className="rounded-[10px] border border-[var(--line)] px-3.5 py-2.5 text-xs font-bold">关闭</button>
              {marking.status !== "CANCELLED" && marking.students.length > 0 ? (
                <button disabled={pending} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">
                  {pending ? "正在保存…" : "保存考勤"}
                </button>
              ) : null}
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}
