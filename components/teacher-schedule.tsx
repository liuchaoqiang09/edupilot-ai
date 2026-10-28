"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { addTeacherLessonStudent, convertAbsentToLeaveForMakeup, convertTeacherTrial, loadTeacherAddChoices, removeTeacherLessonStudent, requestLessonChange, saveAttendance, scheduleTeacherMakeup, searchTeacherStudents, withdrawLessonRequest } from "@/app/teacher/actions";
import { DateField } from "@/components/date-field";
import { LessonFlow } from "@/components/lesson-flow";
import { Modal } from "@/components/modal";
import { WeekGrid } from "@/components/week-grid";
import { coursePalette } from "@/lib/course-colors";
import { paymentMethodLabel } from "@/lib/enrollment-money";
import { attendanceUiOptions, leaveBadgeClass, leaveKindLabel, toAttendanceUi, type AttendanceUiValue } from "@/lib/leave-kind";
import { lessonStatusLabel } from "@/lib/lesson-labels";

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
  billingType: "PER_LESSON" | "PER_PERIOD";
  canEditRoster: boolean;
  canRequestChange: boolean;
  changeRequest: { id: string; summary: string } | null;
  teacherName: string;
  location: string | null;
  status: keyof typeof lessonStatusLabel;
  classCapacity: number | null;
  className: string;
  roomCapacity: number | null;
  overClassCapacity: boolean;
  overRoomCapacity: boolean;
  students: {
    id: string;
    lessonStudentId: string;
    name: string;
    phone: string | null;
    inactive: boolean;
    archiveReason: string | null;
    attendanceStatus: "NOT_MARKED" | "PRESENT" | "ABSENT" | "LATE" | "LEAVE";
    leaveKind: "PERSONAL" | "SICK" | null;
    attendanceNote: string | null;
    parentLeave: boolean;
    seat: "ENROLLED" | "GUEST" | "TRIAL" | "CONVERTED";
    seatLabel: string;
    makeupText: string | null;
    usageText: string;
    canMakeup: boolean;
  }[];
};

type MakeupOption = { id: string; courseId: string; label: string };

type Draft = { status: AttendanceUiValue; note: string };

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
  makeupOptions,
  colleagues,
  showIntro = true,
  openLessonId = "",
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
  makeupOptions: MakeupOption[];
  colleagues: { id: string; name: string }[];
  showIntro?: boolean;
  openLessonId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [requestPending, startRequest] = useTransition();
  const [marking, setMarking] = useState<TeacherLesson | null>(null);
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [rosterNote, setRosterNote] = useState("");
  const [rosterWarning, setRosterWarning] = useState("");
  const [choices, setChoices] = useState<{ id: string; name: string }[]>([]);
  const [hits, setHits] = useState<{ id: string; name: string; studentNo: string | null }[]>([]);
  const [convertFor, setConvertFor] = useState<string | null>(null);
  const [pendingAdd, setPendingAdd] = useState<{ studentId: string; seat: string } | null>(null);
  const [pendingMakeup, setPendingMakeup] = useState<{ sourceId: string; targetLessonId: string } | null>(null);
  const [leaveConvertFor, setLeaveConvertFor] = useState<string | null>(null);
  const [convertKind, setConvertKind] = useState<"PERSONAL" | "SICK">("SICK");
  const [forceMakeupSourceId, setForceMakeupSourceId] = useState<string | null>(null);
  const openedLesson = useRef("");
  const [slotMinutes, setSlotMinutes] = useState<30 | 45 | 60>(60);

  useEffect(() => {
    if (!marking) return;
    const next = lessons.find((lesson) => lesson.id === marking.id);
    if (!next || next === marking) return;
    setMarking(next);
    setDraft((current) => {
      const merged = { ...current };
      for (const student of next.students) {
        if (merged[student.id]) continue;
        merged[student.id] = {
          status: student.attendanceStatus === "NOT_MARKED" ? "PRESENT" : toAttendanceUi(student.attendanceStatus, student.leaveKind),
          note: student.attendanceNote ?? "",
        };
      }
      return merged;
    });
  }, [lessons, marking]);

  function openLesson(lesson: TeacherLesson) {
    const next: Record<string, Draft> = {};
    for (const student of lesson.students) {
      next[student.id] = {
        status: student.attendanceStatus === "NOT_MARKED" ? "PRESENT" : toAttendanceUi(student.attendanceStatus, student.leaveKind),
        note: student.attendanceNote ?? "",
      };
    }
    setDraft(next);
    setQuery("");
    setMessage("");
    setRosterNote("");
    setRosterWarning("");
    setHits([]);
    setConvertFor(null);
    setLeaveConvertFor(null);
    setConvertKind("SICK");
    setForceMakeupSourceId(null);
    openedLesson.current = lesson.id;
    setMarking(lesson);
    if (lesson.canEditRoster) {
      const lessonId = lesson.id;
      void loadTeacherAddChoices(lessonId).then((rows) => {
        if (openedLesson.current === lessonId) setChoices(rows);
      });
    } else {
      setChoices([]);
    }
  }

  useEffect(() => {
    if (!openLessonId) return;
    const lesson = lessons.find((item) => item.id === openLessonId);
    if (lesson) openLesson(lesson);
    // 从助教打开这一节课的考勤。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openLessonId]);

  function submitConvert(lessonStudentId: string) {
    const root = document.getElementById(`convert-${lessonStudentId}`);
    if (!root) return;
    const data = new FormData();
    for (const field of root.querySelectorAll("input, select")) {
      if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement) || !field.name) continue;
      data.set(field.name, field.value);
    }
    runRoster(() => convertTeacherTrial(lessonStudentId, data));
  }

  function runRoster(task: () => Promise<{ ok: boolean; message?: string; warning?: string }>) {
    setRosterNote("");
    startTransition(async () => {
      const result = await task();
      if (result.warning) {
        setRosterWarning(result.warning);
        return;
      }
      setRosterWarning("");
      setRosterNote(result.message ?? (result.ok ? "已保存。" : "操作失败。"));
      if (result.ok) {
        setHits([]);
        setConvertFor(null);
        setPendingAdd(null);
        setPendingMakeup(null);
        if (marking?.canEditRoster) setChoices(await loadTeacherAddChoices(marking.id));
        router.refresh();
      }
    });
  }

  function addStudent(studentId: string, seat: string, acknowledge = false) {
    if (!marking) return;
    const data = new FormData();
    data.set("studentId", studentId);
    data.set("seat", seat);
    if (acknowledge) data.set("acknowledgeConflict", "1");
    setPendingAdd({ studentId, seat });
    setPendingMakeup(null);
    runRoster(() => addTeacherLessonStudent(marking.id, data));
  }

  function arrangeMakeup(sourceId: string, targetLessonId: string, acknowledge = false) {
    if (!targetLessonId) {
      setRosterNote("请选择一节已有课次。");
      return;
    }
    const data = new FormData();
    data.set("targetLessonId", targetLessonId);
    if (acknowledge) data.set("acknowledgeConflict", "1");
    setPendingMakeup({ sourceId, targetLessonId });
    setPendingAdd(null);
    runRoster(() => scheduleTeacherMakeup(sourceId, data));
  }

  function addChosen(selectId: string, seat: string) {
    const studentId = (document.getElementById(selectId) as HTMLSelectElement | null)?.value ?? "";
    if (!studentId) {
      setRosterNote("请选择学生。");
      return;
    }
    addStudent(studentId, seat);
  }

  function confirmRosterConflict() {
    if (pendingMakeup) {
      arrangeMakeup(pendingMakeup.sourceId, pendingMakeup.targetLessonId, true);
      return;
    }
    if (!pendingAdd) return;
    addStudent(pendingAdd.studentId, pendingAdd.seat, true);
  }

  function markAllPresent() {
    if (!marking || marking.status === "CANCELLED") return;
    setDraft((current) => {
      const next = { ...current };
      for (const student of marking.students) {
        if (student.inactive) continue;
        const prior = next[student.id] ?? {
          status: student.attendanceStatus === "NOT_MARKED" ? "PRESENT" : toAttendanceUi(student.attendanceStatus, student.leaveKind),
          note: student.attendanceNote ?? "",
        };
        // 已批准的请假（含家长请假）不能被一键全勤强行改成出勤。
        if (student.parentLeave || prior.status === "PERSONAL" || prior.status === "SICK" || student.attendanceStatus === "LEAVE") {
          next[student.id] = { ...prior, status: prior.status === "SICK" || student.leaveKind === "SICK" ? "SICK" : "PERSONAL" };
          continue;
        }
        next[student.id] = { ...prior, status: "PRESENT" };
      }
      return next;
    });
  }

  function attendanceDirty() {
    if (!marking) return false;
    return marking.students.some((student) => {
      if (student.inactive) return false;
      const row = draft[student.id];
      if (!row) return false;
      const baseline = student.attendanceStatus === "NOT_MARKED" ? "PRESENT" : toAttendanceUi(student.attendanceStatus, student.leaveKind);
      return row.status !== baseline || row.note !== (student.attendanceNote ?? "");
    });
  }

  function runConvertToLeave(lessonStudentId: string) {
    const data = new FormData();
    data.set("leaveKind", convertKind);
    setMessage("");
    startTransition(async () => {
      const result = await convertAbsentToLeaveForMakeup(lessonStudentId, data);
      setMessage(result.message ?? (result.ok ? "已转换。" : "转换失败。"));
      if (result.ok && result.sourceId) {
        setLeaveConvertFor(null);
        setForceMakeupSourceId(result.sourceId);
        router.refresh();
      }
    });
  }

  function closeAttendance() {
    if (attendanceDirty() && !window.confirm("考勤还没保存，确定关闭吗？")) return;
    setMarking(null);
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
      if (result.message) {
        setMessage(result.message);
        router.refresh();
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
        <>
          {lessons.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-[var(--line)] bg-white px-5 py-8 text-center text-sm leading-7 text-[var(--muted)]">这一周没有分配给你的课次。</p>
          ) : null}
          <WeekGrid slotMinutes={slotMinutes} days={weekDays} lessons={lessons} onOpen={openLesson} />
        </>
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
                  <div className="mt-1 text-[11px] text-[var(--muted)]">{lesson.courseName} · {lesson.students.length} 人 · {lesson.location ?? "地点待定"}{lesson.status === "CANCELLED" ? ` · ${lessonStatusLabel.CANCELLED}` : ""}{lesson.students.some((student) => student.parentLeave) ? ` · 家长请假 ${lesson.students.filter((student) => student.parentLeave).length} 人` : ""}</div>
                  {lesson.students.some((student) => student.inactive) ? <div className="mt-1 text-[11px] font-bold text-[#74838b]">该课次包含已停用学生</div> : null}
                </div>
                {lesson.status === "CANCELLED" ? (
                  <button type="button" onClick={() => openLesson(lesson)} className="text-xs font-bold text-[var(--teal)]">查看</button>
                ) : (
                  <Link href={`/teacher/attendance?tab=day&date=${lesson.dateKey}&lesson=${lesson.id}`} className="text-xs font-bold text-[var(--teal)]">学生签到</Link>
                )}
              </li>
              );
            })}
          </ul>
        )}
      </div>
      )}

      {marking ? (
        <Modal title={marking.status === "CANCELLED" ? "课次已取消" : "记录考勤"} onClose={closeAttendance}>
          <form
            onSubmit={save}
            onKeyDown={(event) => {
              if (event.key === "Enter" && event.target instanceof HTMLElement && event.target.closest("[data-roster]")) event.preventDefault();
            }}
            className="px-5 py-5"
          >
            <p className="text-sm font-bold">{marking.title}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">{marking.dateLabel} {marking.startLabel} – {marking.endLabel} · {marking.courseName}</p>
            {marking.overClassCapacity || marking.overRoomCapacity ? (
              <p className="mt-2 rounded-xl bg-[#fff0ed] px-3 py-2 text-xs leading-5 text-[#b94d4d]">
                {marking.overClassCapacity
                  ? `班级「${marking.className}」容量 ${marking.classCapacity} 人，本课名单 ${marking.students.length} 人，已超员。排队不会自动顶替，点名仍可保存。`
                  : null}
                {marking.overClassCapacity && marking.overRoomCapacity ? " " : null}
                {marking.overRoomCapacity
                  ? `教室可坐 ${marking.roomCapacity} 人，本课 ${marking.students.length} 人，已超过教室容量。`
                  : null}
              </p>
            ) : null}
            {marking.status === "CANCELLED" ? null : <LessonFlow lessonId={marking.id} dateKey={marking.dateKey} current="attendance" />}
            {marking.students.length === 0 ? (
              <p className="mt-4 text-sm text-[var(--muted)]">这节课没有学生名单。可以关闭本窗口；空课无需保存考勤。</p>
            ) : (
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
                {canEdit ? <p className="mt-2 text-xs leading-6 text-[var(--muted)]">还没点名的学生已先选为出勤。事假/病假不会被一键全勤覆盖。缺勤可点「转为请假并补课」。事假、病假不扣课时；缺勤扣课时。</p> : null}
                {visibleStudents.length === 0 ? <p className="mt-4 text-sm text-[var(--muted)]">没有找到这个姓名。</p> : (
                  <ul className="mt-3 max-h-80 space-y-3 overflow-y-auto">
                    {visibleStudents.map((student) => {
                      const locked = marking.status === "CANCELLED" || student.inactive;
                      const reason = student.archiveReason?.trim() || "未填写";
                      const row = draft[student.id] ?? {
                        status: toAttendanceUi(student.attendanceStatus, student.leaveKind),
                        note: student.attendanceNote ?? "",
                      };
                      const showMakeup = student.canMakeup || forceMakeupSourceId === student.lessonStudentId;
                      return (
                      <li key={student.id} className="rounded-xl border border-[var(--line)] p-3">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-bold">
                          {student.name}
                          {student.parentLeave ? <span className="rounded-full bg-[#fff2df] px-2 py-0.5 text-[10px] font-bold text-[#9a6729]">家长已请假</span> : null}
                          {student.attendanceStatus === "LEAVE" ? (
                            <span className={leaveBadgeClass(student.leaveKind)}>{student.leaveKind === "SICK" ? leaveKindLabel.SICK : leaveKindLabel.PERSONAL}</span>
                          ) : null}
                          <span className="rounded-full bg-[#eef1ee] px-2 py-0.5 text-[10px] font-bold text-[#51656a]">{student.seatLabel}</span>
                          <span className="text-[11px] font-bold text-[#24548f]">{student.usageText}</span>
                          {student.makeupText ? <span className="text-[11px] font-bold text-[#9a6729]">{student.makeupText}</span> : null}
                          {marking.canEditRoster ? (
                            <button type="button" disabled={pending} onClick={() => runRoster(() => removeTeacherLessonStudent(marking.id, student.id))} className="text-[11px] font-bold text-[#9a3434]">移出</button>
                          ) : null}
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
                            {attendanceUiOptions.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
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
                        {!locked && (student.attendanceStatus === "ABSENT" || row.status === "ABSENT") ? (
                          <div className="mt-2">
                            {leaveConvertFor === student.lessonStudentId ? (
                              <div data-roster="" className="grid gap-2 rounded-xl bg-[#f7faf8] p-3">
                                <p className="text-[11px] leading-5 text-[var(--muted)]">转为请假会退回已扣课时（若有），然后选择补课课次。默认病假。</p>
                                <select value={convertKind} onChange={(event) => setConvertKind(event.target.value as "PERSONAL" | "SICK")} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs">
                                  <option value="SICK">病假</option>
                                  <option value="PERSONAL">事假</option>
                                </select>
                                <div className="flex gap-2">
                                  <button type="button" disabled={pending} onClick={() => runConvertToLeave(student.lessonStudentId)} className="rounded-[10px] bg-[var(--teal)] px-3 py-2 text-xs font-bold text-white">确认并选补课</button>
                                  <button type="button" onClick={() => setLeaveConvertFor(null)} className="rounded-[10px] border border-[var(--line)] px-3 py-2 text-xs font-bold">取消</button>
                                </div>
                              </div>
                            ) : (
                              <button type="button" onClick={() => { setLeaveConvertFor(student.lessonStudentId); setConvertKind("SICK"); }} className="text-xs font-bold text-[var(--teal)]">转为请假并补课</button>
                            )}
                          </div>
                        ) : null}
                        {showMakeup ? (
                          <div data-roster="" className="mt-2 flex flex-wrap items-center gap-2">
                            {forceMakeupSourceId === student.lessonStudentId ? <p className="w-full text-[11px] font-bold text-[#34725d]">已转为请假，请选择补课课次。</p> : null}
                            <select id={`makeup-${student.lessonStudentId}`} defaultValue="" className="min-w-[180px] flex-1 rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs">
                              <option value="">选择补课课次</option>
                              {makeupOptions.filter((option) => option.courseId === marking.courseId && option.id !== marking.id).map((option) => (
                                <option key={option.id} value={option.id}>{option.label}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => {
                                const targetLessonId = (document.getElementById(`makeup-${student.lessonStudentId}`) as HTMLSelectElement | null)?.value ?? "";
                                arrangeMakeup(student.lessonStudentId, targetLessonId);
                                setForceMakeupSourceId(null);
                              }}
                              className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold"
                            >安排补课</button>
                          </div>
                        ) : null}
                        {student.seat === "TRIAL" && !student.inactive && marking.status !== "CANCELLED" ? (
                          <div className="mt-2">
                            {convertFor === student.lessonStudentId ? (
                              <div id={`convert-${student.lessonStudentId}`} data-roster="" className="grid gap-2 rounded-xl bg-[#f7faf8] p-3">
                                <p className="text-[11px] leading-5 text-[var(--muted)]">转为报名使用和负责人相同的规则。这节试听不补扣课时。</p>
                                <input name="guardianPhone" defaultValue={student.phone ?? ""} placeholder="联系人电话" className="rounded-[10px] border border-[var(--line)] px-3 py-2 text-sm" />
                                {marking.billingType === "PER_LESSON" ? (
                                  <input name="hoursAdded" placeholder="购买课时" className="rounded-[10px] border border-[var(--line)] px-3 py-2 text-sm" />
                                ) : (
                                  <div className="grid gap-2 sm:grid-cols-2">
                                    <input name="startDate" type="date" className="rounded-[10px] border border-[var(--line)] px-3 py-2 text-sm" />
                                    <input name="endDate" type="date" className="rounded-[10px] border border-[var(--line)] px-3 py-2 text-sm" />
                                  </div>
                                )}
                                <div className="grid gap-2 sm:grid-cols-2">
                                  <input name="amountDue" placeholder="应收（元）" className="rounded-[10px] border border-[var(--line)] px-3 py-2 text-sm" />
                                  <input name="discountPercent" placeholder="折扣，例如 80%，可留空" className="rounded-[10px] border border-[var(--line)] px-3 py-2 text-sm" />
                                  <input name="amount" placeholder="实收（元）" className="rounded-[10px] border border-[var(--line)] px-3 py-2 text-sm" />
                                  <select name="payMethod" defaultValue="CASH" className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-sm">
                                    {Object.entries(paymentMethodLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                  </select>
                                </div>
                                <div className="flex gap-2">
                                  <button type="button" disabled={pending} onClick={() => submitConvert(student.lessonStudentId)} className="rounded-[10px] bg-[var(--teal)] px-3 py-2 text-xs font-bold text-white">保存报名</button>
                                  <button type="button" onClick={() => setConvertFor(null)} className="rounded-[10px] border border-[var(--line)] px-3 py-2 text-xs font-bold">取消</button>
                                </div>
                              </div>
                            ) : (
                              <button type="button" onClick={() => setConvertFor(student.lessonStudentId)} className="text-xs font-bold text-[var(--teal)]">转为报名</button>
                            )}
                          </div>
                        ) : null}
                      </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
            {marking.canEditRoster ? (
              <div data-roster="" className="mt-4 rounded-xl border border-dashed border-[var(--line)] p-3">
                <p className="text-xs font-bold">开课前调整名单</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <select id="roster-class-student" defaultValue="" className="min-w-[160px] flex-1 rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs">
                    <option value="">本班未在名单中的学生</option>
                    {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
                  </select>
                  <button type="button" disabled={pending} onClick={() => addChosen("roster-class-student", "ENROLLED")} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">加入本班</button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input id="roster-search" placeholder="查找其他学生" className="min-w-[140px] flex-1 rounded-[10px] border border-[var(--line)] px-3 py-2 text-xs" />
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      const queryText = (document.getElementById("roster-search") as HTMLInputElement | null)?.value ?? "";
                      startTransition(async () => setHits(await searchTeacherStudents(marking.id, queryText)));
                    }}
                    className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold"
                  >查找</button>
                </div>
                {hits.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {hits.map((hit) => (
                      <li key={hit.id} className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-bold">{hit.name}</span>
                        <span className="text-[var(--muted)]">{hit.studentNo ?? "无编号"}</span>
                        <button type="button" disabled={pending} onClick={() => addStudent(hit.id, "GUEST")} className="font-bold text-[var(--teal)]">临时加入</button>
                        <button type="button" disabled={pending} onClick={() => addStudent(hit.id, "TRIAL")} className="font-bold text-[var(--teal)]">加入试听</button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {rosterWarning ? (
              <div className="mt-3 rounded-xl bg-[#fff8ee] px-3 py-2 text-xs leading-5 text-[#9a6729]">
                <p className="whitespace-pre-line">{rosterWarning}</p>
                <button type="button" disabled={pending} onClick={() => confirmRosterConflict()} className="mt-2 font-bold text-[#9a6729]">仍要加入</button>
              </div>
            ) : null}
            {rosterNote ? <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{rosterNote}</p> : null}
            {message ? <p className="mt-3 text-xs text-[#b94d4d]">{message}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={closeAttendance} className="rounded-[10px] border border-[var(--line)] px-3.5 py-2.5 text-xs font-bold">关闭</button>
              {canEdit ? (
                <button disabled={pending} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">
                  {pending ? "正在保存…" : "保存考勤"}
                </button>
              ) : marking.students.length === 0 && marking.status !== "CANCELLED" ? (
                <button type="button" onClick={() => setMarking(null)} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white">知道了</button>
              ) : null}
            </div>
          </form>
          {marking.canRequestChange ? (
            <div className="mt-4 border-t border-[var(--line)] pt-4">
              {marking.changeRequest ? (
                <div className="rounded-xl bg-[#fff8ee] px-3 py-3 text-xs leading-5 text-[#9a6729]">
                  <p>{marking.changeRequest.summary}</p>
                  <button
                    type="button"
                    disabled={requestPending}
                    onClick={() => {
                      const requestId = marking.changeRequest?.id;
                      if (!requestId) return;
                      startRequest(async () => setRosterNote((await withdrawLessonRequest(requestId)).message ?? ""));
                    }}
                    className="mt-2 font-bold"
                  >撤回申请</button>
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  <form
                    className="space-y-2 text-xs"
                    onSubmit={(event) => {
                      event.preventDefault();
                      startRequest(async () => setRosterNote((await requestLessonChange(marking.id, new FormData(event.currentTarget))).message ?? ""));
                    }}
                  >
                    <p className="font-bold text-[var(--ink)]">申请调课</p>
                    <input type="hidden" name="kind" value="RESCHEDULE" />
                    <input name="startDate" type="date" required defaultValue={marking.dateKey} className="w-full rounded-[10px] border border-[var(--line)] px-2 py-2" />
                    <input name="startTime" type="time" required defaultValue={marking.startLabel} className="w-full rounded-[10px] border border-[var(--line)] px-2 py-2" />
                    <input name="endDate" type="date" required defaultValue={marking.dateKey} className="w-full rounded-[10px] border border-[var(--line)] px-2 py-2" />
                    <input name="endTime" type="time" required defaultValue={marking.endLabel} className="w-full rounded-[10px] border border-[var(--line)] px-2 py-2" />
                    <input name="note" maxLength={80} placeholder="说明，选填" className="w-full rounded-[10px] border border-[var(--line)] px-2 py-2" />
                    <button disabled={requestPending} className="rounded-[10px] border border-[var(--line)] px-3 py-2 font-bold">提交调课</button>
                  </form>
                  <form
                    className="space-y-2 text-xs"
                    onSubmit={(event) => {
                      event.preventDefault();
                      startRequest(async () => setRosterNote((await requestLessonChange(marking.id, new FormData(event.currentTarget))).message ?? ""));
                    }}
                  >
                    <p className="font-bold text-[var(--ink)]">申请代课</p>
                    <input type="hidden" name="kind" value="SUBSTITUTE" />
                    <select name="teacherId" required className="w-full rounded-[10px] border border-[var(--line)] px-2 py-2">
                      <option value="">选择教师</option>
                      {colleagues.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}
                    </select>
                    <input name="note" maxLength={80} placeholder="说明，选填" className="w-full rounded-[10px] border border-[var(--line)] px-2 py-2" />
                    <button disabled={requestPending || colleagues.length === 0} className="rounded-[10px] border border-[var(--line)] px-3 py-2 font-bold">提交代课</button>
                  </form>
                </div>
              )}
              <p className="mt-2 text-xs leading-5 text-[var(--muted)]">提交后课次不变，负责人同意才会改。</p>
            </div>
          ) : null}
        </Modal>
      ) : null}
    </section>
  );
}
