"use client";

import { FormEvent, useState, useTransition } from "react";
import { admitWaitlist, joinClassWaitlist } from "@/app/owner/courses/waitlist-actions";
import { Modal } from "@/components/modal";
import { useRouter } from "next/navigation";

export type WaitStudent = { id: string; name: string; studentNo: string | null };
export type WaitEntry = { id: string; studentId: string; studentName: string; joinedAt: string };

export function ClassWaitlistButton({
  classId,
  className,
  full,
  enrolled,
  capacity,
  entries,
  students,
  enrolledStudentIds,
  startOpen = false,
}: {
  classId: string;
  className: string;
  full: boolean;
  enrolled: number;
  capacity: number | null;
  entries: WaitEntry[];
  students: WaitStudent[];
  enrolledStudentIds: string[];
  startOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(startOpen);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const queued = new Set(entries.map((item) => item.studentId));
  const enrolledIds = new Set(enrolledStudentIds);
  const choices = students.filter((student) => !queued.has(student.id) && !enrolledIds.has(student.id));

  function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setMessage("");
    startTransition(async () => {
      const result = await joinClassWaitlist(classId, formData);
      setFailed(!result.ok);
      setMessage(result.message ?? "");
      if (result.ok) router.refresh();
    });
  }

  function admit(id: string) {
    setMessage("");
    startTransition(async () => {
      const result = await admitWaitlist(id);
      setFailed(!result.ok);
      setMessage(result.message ?? "");
      if (result.ok) router.refresh();
    });
  }

  return (
    <>
      <button type="button" className="font-bold text-[var(--teal)]" onClick={() => { setOpen(true); setMessage(""); }}>排队 {entries.length}</button>
      {open ? (
        <Modal title={`${className} 的排队`} onClose={() => setOpen(false)}>
          <div className="grid gap-4 px-5 py-5 text-xs">
            <p className="leading-6 text-[var(--muted)]">
              当前在读 {enrolled}{capacity == null ? "，容量不限" : ` / ${capacity}`}。{full ? "这个班已满，转入会停住；记录报名仍可以选择这个班。" : "转入班级时会检查容量。"}排队的学生不算在读，也不会出现在课表里。
            </p>
            {entries.length === 0 ? <p className="text-[var(--muted)]">还没有人排队。</p> : (
              <ul className="grid gap-2">
                {entries.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] px-3 py-2">
                    <span>
                      <strong>{entry.studentName}</strong>
                      <span className="mt-1 block text-[11px] text-[var(--muted)]">加入于 {entry.joinedAt}</span>
                    </span>
                    <button type="button" disabled={pending} onClick={() => admit(entry.id)} className="font-bold text-[var(--teal)] disabled:opacity-60">转入班级</button>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={join} className="grid gap-2">
              <label className="grid gap-1.5 font-bold">
                加入排队
                <select name="studentId" defaultValue="" className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]">
                  <option value="">请选择学生</option>
                  {choices.map((student) => <option key={student.id} value={student.id}>{student.name}{student.studentNo ? ` · ${student.studentNo}` : ""}</option>)}
                </select>
              </label>
              <button disabled={pending || choices.length === 0} className="w-fit rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 font-bold text-white disabled:opacity-60">{pending ? "正在保存…" : "加入排队"}</button>
            </form>
            {message ? <p className={`leading-6 ${failed ? "text-[#b94d4d]" : "text-[#34725d]"}`}>{message}</p> : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
