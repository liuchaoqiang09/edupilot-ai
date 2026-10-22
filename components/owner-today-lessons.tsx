"use client";

import { useState } from "react";
import { AttendanceBreakdown, AttendanceRing, attendanceRate } from "@/components/attendance-ring";
import { Modal } from "@/components/modal";
import { attendanceLabel } from "@/lib/lesson-labels";

const attendanceTone: Partial<Record<keyof typeof attendanceLabel, string>> = {
  PRESENT: "font-bold text-[#34725d]",
  LEAVE: "font-bold text-[#c27b35]",
  ABSENT: "font-bold text-[#b94d4d]",
  LATE: "font-bold text-[#9a6729]",
};

export type TodayLessonCard = {
  id: string;
  title: string;
  startLabel: string;
  endLabel: string;
  location: string | null;
  courseName: string;
  teacherName: string;
  recorded: boolean;
  started: boolean;
  ended: boolean;
  students: {
    id: string;
    name: string;
    attendanceStatus: keyof typeof attendanceLabel;
    attendanceNote: string | null;
  }[];
};

export function OwnerTodayLessons({ lessons }: { lessons: TodayLessonCard[] }) {
  const [viewing, setViewing] = useState<TodayLessonCard | null>(null);

  return (
    <>
      <ul className="px-5">
        {lessons.map((lesson, index) => {
          const rate = attendanceRate(lesson.students, lesson.started);
          const recordLabel = lesson.recorded ? "已记录" : lesson.ended ? "待填写记录" : null;
          return (
            <li key={lesson.id} className="border-b border-[#f0f2f0] last:border-b-0">
              <button
                type="button"
                onClick={() => setViewing(lesson)}
                className="grid w-full cursor-pointer grid-cols-[58px_4px_minmax(0,1fr)_auto] items-center gap-3 py-4 text-left transition hover:bg-[#f4faf7]"
              >
                <div className="text-xs font-extrabold">
                  {lesson.startLabel}
                  <small className="mt-1 block font-medium text-[var(--muted)]">{lesson.endLabel}</small>
                </div>
                <span className={`h-10 rounded ${["bg-[#91c8b5]", "bg-[#e8b56d]", "bg-[#b7a6e3]"][index % 3]}`} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold">{lesson.courseName} · {lesson.title}</div>
                  <div className="mt-1 text-[11px] leading-5 text-[var(--muted)]">
                    {lesson.teacherName} · {lesson.students.length} 人 · {lesson.location ?? "教室待定"}
                    <span className="mt-0.5 block"><AttendanceBreakdown students={lesson.students} /></span>
                  </div>
                </div>
                <span className="flex w-[136px] shrink-0 items-center justify-between gap-4">
                  <AttendanceRing rate={rate} />
                  <span className="flex w-[76px] justify-end">
                    {recordLabel ? (
                      <span className={`whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-bold ${recordLabel === "已记录" ? "bg-[#edf5f1] text-[#34725d]" : "bg-[#fff2df] text-[#9a6729]"}`}>{recordLabel}</span>
                    ) : null}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {viewing ? (
        <Modal title="课次出勤" onClose={() => setViewing(null)}>
          <div className="space-y-3 px-5 py-5 text-sm">
            <div className="font-bold">{viewing.courseName} · {viewing.title}</div>
            <p className="text-[var(--muted)]">{viewing.startLabel} – {viewing.endLabel} · {viewing.teacherName} · {viewing.location ?? "教室待定"}</p>
            <p className="text-xs leading-6 text-[var(--muted)]">考勤由授课教师记录。这里只查看到课情况。</p>
            {viewing.students.length === 0 ? <p className="text-[var(--muted)]">这节课还没有学生。</p> : (
              <ul className="space-y-2">
                {viewing.students.map((student) => (
                  <li key={student.id} className="flex items-start justify-between gap-3 rounded-xl bg-[#f7faf8] px-3 py-2">
                    <span className="font-bold">{student.name}</span>
                    <span className="text-right text-xs">
                      <span className={attendanceTone[student.attendanceStatus]}>{attendanceLabel[student.attendanceStatus]}</span>
                      {student.attendanceNote?.trim() ? <span className="mt-1 block text-[var(--muted)]">{student.attendanceNote.trim()}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end">
              <button type="button" onClick={() => setViewing(null)} className="rounded-[10px] border border-[var(--line)] px-3.5 py-2.5 text-xs font-bold">关闭</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

