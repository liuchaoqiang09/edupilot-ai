"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";
import { saveAttendance } from "@/app/teacher/actions";
import { DateField } from "@/components/date-field";
import { Modal } from "@/components/modal";
import { WeekGrid } from "@/components/week-grid";
import { coursePalette } from "@/lib/course-colors";
import { attendanceLabel, attendanceOptions, lessonStatusLabel } from "@/lib/lesson-labels";

export type TeacherLesson = {
  id: string;
  title: string;
  dateKey: string;
  dateLabel: string;
  startLabel: string;
  endLabel: string;
  startMinutes: number;
  endMinutes: number;
  courseId: string;
  courseName: string;
  teacherName: string;
  location: string | null;
  status: keyof typeof lessonStatusLabel;
  students: { id: string; name: string; inactive: boolean; archiveReason: string | null; attendanceStatus: keyof typeof attendanceLabel; attendanceNote: string | null }[];
};

type Draft = { status: keyof typeof attendanceLabel; note: string };

export function TeacherSchedule({
  view,
  date,
  previousDate,
  nextDate,
  dateLabel,
  weekStart,
  weekDays,
  previousWeek,
  nextWeek,
  linked,
  lessons,
  showIntro = true,
}: {
  view: "day" | "week";
  date: string;
  previousDate: string;
  nextDate: string;
  dateLabel: string;
  weekStart: string;
  weekDays: { key: string; weekday: string; dateLabel: string }[];
  previousWeek: string | null;
  nextWeek: string | null;
  linked: boolean;
  lessons: TeacherLesson[];
  showIntro?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [marking, setMarking] = useState<TeacherLesson | null>(null);
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [slotMinutes, setSlotMinutes] = useState<30 | 45 | 60>(60);

  function openLesson(lesson: TeacherLesson) {
    const next: Record<string, Draft> = {};
    for (const student of lesson.students) {
      next[student.id] = {
        status: student.attendanceStatus === "NOT_MARKED" ? "PRESENT" : student.attendanceStatus,
        note: student.attendanceNote ?? "",
      };
    }
    setDraft(next);
    setQuery("");
    setMessage("");
    setMarking(lesson);
  }

  function markAllPresent() {
    if (!marking || marking.status === "CANCELLED") return;
    setDraft((current) => {
      const next = { ...current };
      for (const student of marking.students) {
        if (student.inactive) continue;
        next[student.id] = { ...next[student.id], status: "PRESENT" };
      }
      return next;
    });
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!marking) return;
    const formData = new FormData();
    for (const student of marking.students) {
      if (student.inactive) continue;
      const row = draft[student.id];
      if (!row) continue;
      formData.set(`status:${student.id}`, row.status);
      formData.set(`note:${student.id}`, row.note);
    }
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

  const keyword = query.trim();
  const visibleStudents = marking?.students.filter((student) => !keyword || student.name.includes(keyword)) ?? [];
  const canEdit = Boolean(marking && marking.status !== "CANCELLED" && marking.students.some((student) => !student.inactive));

  return (
    <section id="schedule" className="scroll-mt-24">
      {showIntro ? (
        <>
          <h1 className="text-[28px] font-semibold tracking-tight">我的课表</h1>
        </>
      ) : null}

      {!linked ? (
        <p className="mt-4 rounded-xl bg-[#fff2df] px-4 py-3 text-xs leading-6 text-[#9a6729]">
          当前登录账号还没有关联教师档案。请让机构负责人在「教师管理」里，把这个账号关联到对应教师。
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="flex rounded-[10px] border border-[var(--line)] bg-white p-1">
          <Link href={`/teacher/schedule?view=day&date=${date}`} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${view === "day" ? "bg-[var(--teal)] text-white" : "text-[#385058]"}`}>单日列表</Link>
          <Link href={`/teacher/schedule?view=week&week=${weekStart}&date=${date}`} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${view === "week" ? "bg-[var(--teal)] text-white" : "text-[#385058]"}`}>周视图</Link>
        </div>
        {view === "day" ? (
          <>
            <Link href={`/teacher/schedule?view=day&date=${previousDate}`} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">前一天</Link>
            <form action="/teacher/schedule" className="flex items-center gap-2">
              <input type="hidden" name="view" value="day" />
              <DateField name="date" defaultValue={date} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold" />
              <button className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">查看</button>
            </form>
            <Link href={`/teacher/schedule?view=day&date=${nextDate}`} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">后一天</Link>
            <span className="text-xs text-[var(--muted)]">{dateLabel}</span>
          </>
        ) : (
          <>
            {previousWeek ? (
              <Link href={`/teacher/schedule?view=week&week=${previousWeek}&date=${previousWeek}`} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">上一周 ←</Link>
            ) : (
              <span className="rounded-[10px] border border-[var(--line)] bg-[#f7faf8] px-3 py-2 text-xs font-bold text-[var(--muted)]">上一周 ←</span>
            )}
            {nextWeek ? (
              <Link href={`/teacher/schedule?view=week&week=${nextWeek}&date=${nextWeek}`} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">下一周 →</Link>
            ) : (
              <span className="rounded-[10px] border border-[var(--line)] bg-[#f7faf8] px-3 py-2 text-xs font-bold text-[var(--muted)]">下一周 →</span>
            )}
            <span className="text-xs text-[var(--muted)]">{weekDays[0]?.dateLabel} – {weekDays[6]?.dateLabel}</span>
            <label className="flex items-center gap-2 text-xs font-bold text-[#385058]">
              网格刻度
              <select
                value={slotMinutes}
                onChange={(event) => setSlotMinutes(Number(event.target.value) as 30 | 45 | 60)}
                className="rounded-[10px] border border-[var(--line)] bg-white px-2 py-2 text-xs font-bold outline-none focus:border-[var(--teal)]"
              >
                <option value={30}>半小时（30分钟）</option>
                <option value={45}>45分钟</option>
                <option value={60}>一小时（60分钟）</option>
              </select>
            </label>
          </>
        )}
      </div>
      {view === "week" ? (
        <WeekGrid slotMinutes={slotMinutes} days={weekDays} lessons={lessons} onOpen={openLesson} />
      ) : (
      <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        {lessons.length === 0 ? (
          <p className="px-5 py-12 text-center leading-7 text-[var(--muted)]">这一天没有分配给你的课次。</p>
        ) : (
          <ul className="px-5">
            {lessons.map((lesson) => {
              const palette = coursePalette(lesson.courseId);
              return (
              <li key={lesson.id} className="grid grid-cols-[64px_4px_minmax(0,1fr)_auto] items-center gap-3 border-b border-[#f0f2f0] bg-white py-4 last:border-b-0">
                <div className="text-xs font-extrabold">
                  {lesson.startLabel}
                  <small className="mt-1 block font-medium text-[var(--muted)]">{lesson.endLabel}</small>
                </div>
                <div className="h-10 w-1 rounded" style={{ background: lesson.status === "CANCELLED" ? "#e7c2c2" : palette.accent }} />
                <div>
                  <div className="text-xs font-bold">{lesson.title}</div>
                  <div className="mt-1 text-[11px] text-[var(--muted)]">{lesson.courseName} · {lesson.students.length} 人 · {lesson.location ?? "地点待定"}{lesson.status === "CANCELLED" ? ` · ${lessonStatusLabel.CANCELLED}` : ""}</div>
                  {lesson.students.some((student) => student.inactive) ? <div className="mt-1 text-[11px] font-bold text-[#74838b]">该课次包含已停用学生</div> : null}
                </div>
                <button type="button" onClick={() => openLesson(lesson)} className="text-xs font-bold text-[var(--teal)]">
                  {lesson.status === "CANCELLED" ? "查看" : "记录考勤"}
                </button>
              </li>
              );
            })}
          </ul>
        )}
      </div>
      )}

      {marking ? (
        <Modal title={marking.status === "CANCELLED" ? "课次已取消" : "记录考勤"} onClose={() => setMarking(null)}>
          <form onSubmit={save} className="px-5 py-5">
            <p className="text-sm font-bold">{marking.title}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">{marking.dateLabel} {marking.startLabel} – {marking.endLabel} · {marking.courseName}</p>
            {marking.students.length === 0 ? <p className="mt-4 text-sm text-[var(--muted)]">这节课没有学生名单。</p> : (
              <>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索学生姓名"
                    className="min-w-[180px] flex-1 rounded-[10px] border border-[var(--line)] px-3 py-2 text-sm outline-none focus:border-[var(--teal)]"
                  />
                  {canEdit ? (
                    <button type="button" onClick={markAllPresent} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">一键全勤</button>
                  ) : null}
                </div>
                {canEdit ? <p className="mt-2 text-xs leading-6 text-[var(--muted)]">还没点名的学生已先选为出勤。改完请假或缺勤后，点保存才会写入。</p> : null}
                {visibleStudents.length === 0 ? <p className="mt-4 text-sm text-[var(--muted)]">没有找到这个姓名。</p> : (
                  <ul className="mt-3 max-h-80 space-y-3 overflow-y-auto">
                    {visibleStudents.map((student) => {
                      const locked = marking.status === "CANCELLED" || student.inactive;
                      const reason = student.archiveReason?.trim() || "未填写";
                      const row = draft[student.id] ?? { status: student.attendanceStatus, note: student.attendanceNote ?? "" };
                      return (
                      <li key={student.id} className="rounded-xl border border-[var(--line)] p-3">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-bold">
                          {student.name}
                          {student.inactive ? (
                            <button type="button" title={`停用原因：${reason}`} onClick={(event) => event.currentTarget.nextElementSibling?.classList.toggle("hidden")} className="rounded-full bg-[#eef1ee] px-2 py-0.5 text-[10px] font-bold text-[#74838b]">已停用</button>
                          ) : null}
                          {student.inactive ? <span className="hidden text-[11px] font-medium text-[#74838b]">停用原因：{reason}</span> : null}
                        </div>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <select
                            value={row.status}
                            disabled={locked}
                            title={student.inactive ? `停用原因：${reason}` : undefined}
                            onChange={(event) => setDraft((current) => ({ ...current, [student.id]: { ...row, status: event.target.value as Draft["status"] } }))}
                            className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-sm disabled:bg-[#f4f6f5] disabled:text-[#74838b]"
                          >
                            {attendanceOptions.map((status) => (
                              <option key={status} value={status}>{attendanceLabel[status]}</option>
                            ))}
                          </select>
                          <input
                            value={row.note}
                            placeholder="备注，例如病假、事假"
                            disabled={locked}
                            onChange={(event) => setDraft((current) => ({ ...current, [student.id]: { ...row, note: event.target.value } }))}
                            className="rounded-[10px] border border-[var(--line)] px-3 py-2 text-sm outline-none focus:border-[var(--teal)] disabled:bg-[#f4f6f5]"
                          />
                        </div>
                      </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
            {message ? <p className="mt-3 text-xs text-[#b94d4d]">{message}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setMarking(null)} className="rounded-[10px] border border-[var(--line)] px-3.5 py-2.5 text-xs font-bold">关闭</button>
              {canEdit ? (
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
