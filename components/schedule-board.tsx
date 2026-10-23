"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";
import { cancelLesson, createLesson, createRecurringLessons, removeLessonStudent, updateLessonTeacher, type FieldErrors, type RecurringFieldErrors } from "@/app/owner/schedule/actions";
import { shiftDate } from "@/lib/datetime";
import { DateField, DateTimeField } from "@/components/date-field";
import { FieldError, TextField } from "@/components/form-fields";
import { Modal } from "@/components/modal";
import { AttendanceBreakdown, AttendanceRing, attendanceRate } from "@/components/attendance-ring";
import { LessonClock } from "@/components/lesson-clock";
import { LessonRosterPicker } from "@/components/lesson-roster-picker";
import { attendanceLabel, lessonStatusLabel } from "@/lib/lesson-labels";
import { WeekGrid } from "@/components/week-grid";
import { coursePalette } from "@/lib/course-colors";

const attendanceTone: Partial<Record<keyof typeof attendanceLabel, string>> = {
  PRESENT: "font-bold text-[#34725d]",
  LEAVE: "font-bold text-[#c27b35]",
  ABSENT: "font-bold text-[#b94d4d]",
  LATE: "font-bold text-[#9a6729]",
};
const followUpStatuses = new Set<keyof typeof attendanceLabel>(["LEAVE", "ABSENT", "LATE"]);

export type ScheduleClassOption = {
  id: string;
  name: string;
  courseId: string;
  courseName: string;
  teacherId: string;
  teacherName: string;
};

export type ScheduleTeacherOption = { id: string; name: string; linked: boolean };

export type ScheduleLesson = {
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
  className: string;
  teacherId: string;
  teacherName: string;
  location: string | null;
  status: keyof typeof lessonStatusLabel;
  students: {
    id: string;
    name: string;
    grade: string | null;
    age: number | null;
    parentContact: string;
    attendanceStatus: keyof typeof attendanceLabel;
    attendanceNote: string | null;
  }[];
};

export function ScheduleBoard({
  view,
  pendingRecords = false,
  spanDates = false,
  next7Days = false,
  date,
  previousDate,
  nextDate,
  dateLabel,
  weekStart,
  weekDays,
  previousWeek,
  nextWeek,
  lessons,
  classes,
  teachers,
}: {
  view: "day" | "week";
  pendingRecords?: boolean;
  spanDates?: boolean;
  next7Days?: boolean;
  date: string;
  previousDate: string;
  nextDate: string;
  dateLabel: string;
  weekStart: string;
  weekDays: { key: string; weekday: string; dateLabel: string }[];
  previousWeek: string | null;
  nextWeek: string;
  lessons: ScheduleLesson[];
  classes: ScheduleClassOption[];
  teachers: ScheduleTeacherOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [recurring, setRecurring] = useState(false);
  const [recurringClassId, setRecurringClassId] = useState(classes[0]?.id ?? "");
  const [recurringErrors, setRecurringErrors] = useState<RecurringFieldErrors>({});
  const [recurringMessage, setRecurringMessage] = useState("");
  const [rosterIds, setRosterIds] = useState<string[]>([]);
  const [createRosterIds, setCreateRosterIds] = useState<string[]>([]);
  const [shownLessons, setShownLessons] = useState(lessons);
  const [viewing, setViewing] = useState<ScheduleLesson | null>(null);
  const [removing, setRemoving] = useState<{ id: string; name: string; marked: boolean } | null>(null);
  const [attendanceDetail, setAttendanceDetail] = useState<ScheduleLesson["students"][number] | null>(null);
  const [cancelling, setCancelling] = useState<ScheduleLesson | null>(null);
  const [classId, setClassId] = useState(classes[0]?.id ?? "");
  const [teacherId, setTeacherId] = useState(classes[0]?.teacherId ?? "");
  const [message, setMessage] = useState("");
  const [warning, setWarning] = useState("");
  const [conflictWarning, setConflictWarning] = useState("");
  const [teacherWarning, setTeacherWarning] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [slotMinutes, setSlotMinutes] = useState<30 | 45 | 60>(60);

  const selectedClass = useMemo(() => classes.find((item) => item.id === classId) ?? null, [classes, classId]);
  const recurringClass = useMemo(() => classes.find((item) => item.id === recurringClassId) ?? null, [classes, recurringClassId]);
  useEffect(() => {
    setShownLessons(lessons);
  }, [lessons]);
  const weekdays = [
    ["1", "周一"],
    ["2", "周二"],
    ["3", "周三"],
    ["4", "周四"],
    ["5", "周五"],
    ["6", "周六"],
    ["0", "周日"],
  ] as const;

  function openRecurring() {
    const first = classes[0];
    setRecurringClassId(first?.id ?? "");
    setRosterIds([]);
    setRecurringErrors({});
    setRecurringMessage("");
    setRecurring(true);
  }

  function saveRecurring(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setRecurringMessage("");
    setRecurringErrors({});
    startTransition(async () => {
      const result = await createRecurringLessons(formData);
      if (!result.ok || result.created === 0) {
        setRecurringMessage(result.message ?? "");
        setRecurringErrors(result.fieldErrors ?? {});
        return;
      }
      setRecurring(false);
      setWarning(result.message ?? `已生成 ${result.created} 节课。`);
      if (result.firstDate) router.push(`/owner/schedule?date=${result.firstDate}`);
      router.refresh();
    });
  }

  function openCreate() {
    const first = classes[0];
    setClassId(first?.id ?? "");
    setTeacherId(first?.teacherId ?? "");
    setCreateRosterIds([]);
    setFieldErrors({});
    setMessage("");
    setConflictWarning("");
    setCreating(true);
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setMessage("");
    setFieldErrors({});
    startTransition(async () => {
      const result = await createLesson(formData);
      if (!result.ok) {
        setMessage(result.message ?? "");
        setFieldErrors(result.fieldErrors ?? {});
        setConflictWarning(result.warning ?? "");
        return;
      }
      setConflictWarning("");
      setWarning(result.warning ?? "");
      setCreating(false);
      router.refresh();
    });
  }

  function changeTeacher(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!viewing) return;
    const formData = new FormData(event.currentTarget);
    setMessage("");
    setFieldErrors({});
    startTransition(async () => {
      const result = await updateLessonTeacher(viewing.id, formData);
      if (!result.ok) {
        setMessage(result.message ?? "");
        setFieldErrors(result.fieldErrors ?? {});
        setTeacherWarning(result.warning ?? "");
        return;
      }
      setTeacherWarning("");
      setViewing(null);
      setWarning(result.warning ?? "");
      router.refresh();
    });
  }

  function confirmRemove() {
    if (!viewing || !removing) return;
    const lessonId = viewing.id;
    const studentId = removing.id;
    setMessage("");
    startTransition(async () => {
      const result = await removeLessonStudent(lessonId, studentId);
      if (!result.ok) {
        setMessage(result.message ?? "移出失败。");
        setRemoving(null);
        return;
      }
      const nextStudents = (students: ScheduleLesson["students"]) => students.filter((student) => student.id !== studentId);
      setViewing((current) => (current && current.id === lessonId ? { ...current, students: nextStudents(current.students) } : current));
      setShownLessons((current) => current.map((lesson) => (lesson.id === lessonId ? { ...lesson, students: nextStudents(lesson.students) } : lesson)));
      setRemoving(null);
      router.refresh();
    });
  }

  function cancel() {
    if (!cancelling) return;
    setMessage("");
    startTransition(async () => {
      const result = await cancelLesson(cancelling.id);
      if (!result.ok) {
        setMessage(result.message ?? "取消失败。");
        return;
      }
      setCancelling(null);
      setViewing(null);
      setWarning(result.message ?? "课次已取消。");
      router.refresh();
    });
  }

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">排课 / 课表</h1>
          <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">按日期或按周查看课次。周视图只保留本周和前两周，更早的课次在历史课表里。</p>
          <p className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-[var(--teal-2)] px-2.5 py-1 font-bold text-[var(--teal)]">
              {next7Days ? "查看未来 7 天课次" : pendingRecords ? "当前正在查看：待填写记录的课次" : `当前正在查看：${view === "day" ? `${dateLabel} 的单日列表` : `${weekDays[0]?.dateLabel ?? ""} 至 ${weekDays[6]?.dateLabel ?? ""} 的周视图`}`}
            </span>
            {next7Days || pendingRecords ? <Link href={`/owner/schedule?view=day&date=${date}`} className="font-bold text-[var(--teal)]">重置</Link> : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={openRecurring} className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold text-[#385058]">
            周期排课
          </button>
          <button type="button" onClick={openCreate} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white">
            ＋ 创建课次
          </button>
        </div>
      </div>

      {warning ? <p className="mt-4 rounded-xl bg-[#fff2df] px-4 py-3 text-xs leading-6 text-[#9a6729]">{warning}</p> : null}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="flex rounded-[10px] border border-[var(--line)] bg-white p-1">
          <Link href={next7Days ? "/owner/schedule?range=next7days" : spanDates ? "/owner/schedule?status=待填写" : pendingRecords ? `/owner/schedule?view=day&date=${date}&status=待填写` : `/owner/schedule?date=${date}`} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${view === "day" ? "bg-[var(--teal)] text-white" : "text-[#385058]"}`}>单日列表</Link>
          <Link href={`/owner/schedule?view=week&week=${weekStart}&date=${date}`} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${view === "week" ? "bg-[var(--teal)] text-white" : "text-[#385058]"}`}>周视图</Link>
        </div>
        <Link href="/owner/schedule/history" className="rounded-[10px] border border-[var(--teal)] bg-white px-3 py-2 text-xs font-bold text-[var(--teal)]">查看历史课表</Link>
        {view === "day" && !spanDates && !next7Days ? (
          <>
            <Link href={`/owner/schedule?view=day&date=${previousDate}${pendingRecords ? "&status=待填写" : ""}`} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">前一天</Link>
            <form action="/owner/schedule" className="flex items-center gap-2">
              <input type="hidden" name="view" value="day" />
              {pendingRecords ? <input type="hidden" name="status" value="待填写" /> : null}
              <DateField name="date" defaultValue={date} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold" />
              <button className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">查看</button>
            </form>
            <Link href={`/owner/schedule?view=day&date=${nextDate}${pendingRecords ? "&status=待填写" : ""}`} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">后一天</Link>
            <span className="text-xs text-[var(--muted)]">{dateLabel}</span>
          </>
        ) : view === "week" ? (
          <>
            {previousWeek ? (
              <Link href={`/owner/schedule?view=week&week=${previousWeek}&date=${date}`} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">上一周 ←</Link>
            ) : (
              <span className="rounded-[10px] border border-[var(--line)] bg-[#f7faf8] px-3 py-2 text-xs font-bold text-[var(--muted)]">上一周 ←</span>
            )}
            <Link href={`/owner/schedule?view=week&week=${nextWeek}&date=${date}`} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">下一周 →</Link>
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
        ) : null}
      </div>
      {view === "week" ? <p className="mt-3 text-xs leading-6 text-[var(--muted)]">周视图每次只读取这一周。往前最多两周，更早的课次请打开历史课表。</p> : null}

      {view === "week" ? (
        <WeekGrid slotMinutes={slotMinutes} days={weekDays} lessons={shownLessons} onOpen={(lesson) => { setTeacherWarning(""); setMessage(""); setFieldErrors({}); setRemoving(null); setViewing(lesson); }} />
      ) : (
      <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        {shownLessons.length === 0 ? (
          <p className="px-5 py-12 text-center leading-7 text-[var(--muted)]">{next7Days ? "今天起 7 天还没有课次。" : spanDates ? "没有已结束、待填写记录的课次。" : pendingRecords ? "这一天没有已结束、待填写记录的课次。" : "这一天还没有课次。"}</p>
        ) : (
          <ul className="px-5">
            {shownLessons.map((lesson) => {
              const marked = lesson.students.filter((student) => student.attendanceStatus !== "NOT_MARKED").length;
              const palette = coursePalette(lesson.courseId);
              return (
                <li key={lesson.id} className="grid grid-cols-[76px_4px_minmax(0,1fr)_auto] items-center gap-3 border-b border-[#f0f2f0] bg-white py-4 last:border-b-0">
                  <LessonClock start={lesson.startLabel} end={lesson.endLabel} date={spanDates || next7Days ? lesson.dateLabel : undefined} />
                  <div className="h-10 w-1 rounded" style={{ background: palette.accent }} />
                  <div className="min-w-0">
                    <div className="text-xs font-bold">{lesson.title}</div>
                    <div className="mt-1 text-[11px] text-[var(--muted)]">
                      {lesson.teacherName} · {lesson.students.length} 人 · 已标记 {marked} 人
                      {" · "}<AttendanceBreakdown students={lesson.students} />
                      {lesson.students.some((student) => student.attendanceStatus !== "NOT_MARKED") ? " · " : ""}
                      {lesson.location ?? "地点待定"}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <AttendanceRing rate={attendanceRate(lesson.students)} />
                    <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${lesson.status === "CANCELLED" ? "bg-[#fff0ed] text-[#b94d4d]" : "bg-[#edf5f1] text-[#34725d]"}`}>
                      {lessonStatusLabel[lesson.status]}
                    </span>
                    <button type="button" className="text-xs font-bold text-[var(--teal)]" onClick={() => { setTeacherWarning(""); setMessage(""); setFieldErrors({}); setAttendanceDetail(null); setRemoving(null); setViewing(lesson); }}>查看</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      )}

      {recurring ? (
        <Modal title="周期排课" onClose={() => setRecurring(false)}>
          <form onSubmit={saveRecurring} className="px-5 py-5">
            <div className="grid gap-3">
              <label className="grid gap-1.5 text-xs font-bold">
                班级 <span className="font-medium text-[#9a6729]">必填</span>
                <select
                  name="classGroupId"
                  value={recurringClassId}
                  onChange={(event) => {
                    setRecurringClassId(event.target.value);
                    setRosterIds([]);
                  }}
                  className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]"
                >
                  <option value="">请选择班级</option>
                  {classes.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
                <FieldError message={recurringErrors.classGroupId} />
              </label>
              <p className="rounded-xl bg-[#f7faf8] px-3 py-2 text-xs leading-6 text-[var(--muted)]">
                课程：{recurringClass?.courseName ?? "选择班级后自动带出"}
                <br />
                教师：{recurringClass?.teacherName ?? "选择班级后自动带出"}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5 text-xs font-bold">
                  开始日期 <span className="font-medium text-[#9a6729]">必填</span>
                  <DateField name="startDate" required defaultValue={date} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]" />
                  <FieldError message={recurringErrors.startDate} />
                </label>
                <label className="grid gap-1.5 text-xs font-bold">
                  结束日期 <span className="font-medium text-[#9a6729]">必填</span>
                  <DateField name="endDate" required defaultValue={shiftDate(date, 120)} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]" />
                  <FieldError message={recurringErrors.endDate} />
                </label>
              </div>
              <fieldset className="grid gap-2">
                <legend className="text-xs font-bold">星期 <span className="font-medium text-[#9a6729]">可多选</span></legend>
                <div className="flex flex-wrap gap-2">
                  {weekdays.map(([value, label]) => (
                    <label key={value} className="flex items-center gap-1.5 rounded-[10px] border border-[var(--line)] px-2.5 py-2 text-xs font-bold">
                      <input type="checkbox" name="weekdays" value={value} defaultChecked={value === "1" || value === "3" || value === "5"} className="accent-[var(--teal)]" />
                      {label}
                    </label>
                  ))}
                </div>
                <FieldError message={recurringErrors.weekdays} />
              </fieldset>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5 text-xs font-bold">
                  开始时间 <span className="font-medium text-[#9a6729]">必填</span>
                  <input type="time" name="startTime" required defaultValue="16:00" className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]" />
                  <FieldError message={recurringErrors.startTime} />
                </label>
                <label className="grid gap-1.5 text-xs font-bold">
                  结束时间 <span className="font-medium text-[#9a6729]">必填</span>
                  <input type="time" name="endTime" required defaultValue="17:30" className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]" />
                  <FieldError message={recurringErrors.endTime} />
                </label>
              </div>
              <label className="flex items-start gap-2 text-xs leading-6">
                <input type="checkbox" name="skipWeekends" value="1" className="mt-1 accent-[var(--teal)]" />
                <span>
                  <span className="font-bold">跳过周末</span>
                  <span className="mt-1 block text-[var(--muted)]">法定节假日暂时不会自动避开。勾选后，周六和周日不会生成课次。以后可以接入节假日日历。</span>
                </span>
              </label>
              <TextField label="地点" name="location" placeholder="例如 A201，每一节都使用这个地点" error={recurringErrors.location} />
              <LessonRosterPicker
                classGroupId={recurringClassId}
                selectedIds={rosterIds}
                onChange={setRosterIds}
                error={recurringErrors.students}
              />
              <p className="text-xs leading-6 text-[var(--muted)]">同一班级或同一教师已经有重叠时间时，那一天会跳过，不会覆盖已有课次。</p>
            </div>
            {recurringMessage ? <p className="mt-3 text-xs leading-6 text-[#9a6729]">{recurringMessage}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setRecurring(false)} className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold">取消</button>
              <button disabled={pending || classes.length === 0} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">
                {pending ? "正在生成…" : "生成课次"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {creating ? (
        <Modal title="创建课次" onClose={() => setCreating(false)}>
          <form onSubmit={save} className="px-5 py-5">
            <div className="grid gap-3">
              <label className="grid gap-1.5 text-xs font-bold">
                班级 <span className="font-medium text-[#9a6729]">必填</span>
                <select
                  name="classGroupId"
                  value={classId}
                  onChange={(event) => {
                    const next = classes.find((item) => item.id === event.target.value);
                    setClassId(event.target.value);
                    setCreateRosterIds([]);
                    if (next) setTeacherId(next.teacherId);
                  }}
                  className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]"
                >
                  <option value="">请选择班级</option>
                  {classes.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
                <FieldError message={fieldErrors.classGroupId} />
              </label>
              <p className="rounded-xl bg-[#f7faf8] px-3 py-2 text-xs leading-6 text-[var(--muted)]">
                课程：{selectedClass?.courseName ?? "选择班级后自动带出"}
              </p>
              <label className="grid gap-1.5 text-xs font-bold">
                主讲教师 <span className="font-medium text-[#9a6729]">必填</span>
                <select name="teacherId" value={teacherId} onChange={(event) => { setTeacherId(event.target.value); setConflictWarning(""); }} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]">
                  <option value="">请选择教师</option>
                  {teachers.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>{teacher.name}{teacher.linked ? " · 可登录查看" : " · 未关联账号"}</option>
                  ))}
                </select>
                <FieldError message={fieldErrors.teacherId} />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5 text-xs font-bold">
                  开始时间 <span className="font-medium text-[#9a6729]">必填</span>
                  <DateTimeField name="startAt" required defaultValue={`${date}T16:00`} onChange={() => setConflictWarning("")} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]" />
                  <FieldError message={fieldErrors.startAt} />
                </label>
                <label className="grid gap-1.5 text-xs font-bold">
                  结束时间 <span className="font-medium text-[#9a6729]">必填</span>
                  <DateTimeField name="endAt" required defaultValue={`${date}T17:30`} onChange={() => setConflictWarning("")} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]" />
                  <FieldError message={fieldErrors.endAt} />
                </label>
              </div>
              <TextField label="地点" name="location" placeholder="例如 A201" error={fieldErrors.location} />
              <LessonRosterPicker
                classGroupId={classId}
                selectedIds={createRosterIds}
                onChange={setCreateRosterIds}
                error={fieldErrors.students}
              />
            </div>
            {conflictWarning ? (
              <>
                <input type="hidden" name="acknowledgeConflict" value="1" />
                <p className="mt-3 rounded-xl bg-[#fff2df] px-3 py-3 text-xs leading-6 text-[#9a6729]">{conflictWarning}</p>
              </>
            ) : null}
            {message ? <p className="mt-3 text-xs text-[#b94d4d]">{message}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setCreating(false)} className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold">取消</button>
              <button disabled={pending || classes.length === 0} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">
                {pending ? "正在保存…" : conflictWarning ? "仍然保存" : "保存"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {viewing ? (
        <Modal title="课次详情" onClose={() => { setViewing(null); setRemoving(null); }}>
          <div className="space-y-3 px-5 py-5 text-sm">
            <div className="font-bold">{viewing.title}</div>
            <p className="text-[var(--muted)]">{viewing.startLabel} – {viewing.endLabel} · {viewing.teacherName} · {viewing.location ?? "地点待定"}</p>
            {viewing.students.some((student) => student.attendanceStatus !== "NOT_MARKED") ? <p className="text-xs leading-6"><AttendanceBreakdown students={viewing.students} /></p> : null}
            <p className="text-xs leading-6 text-[var(--muted)]">考勤由授课教师记录，负责人无权修改。</p>
            {viewing.students.length === 0 ? <p className="text-[var(--muted)]">这节课还没有学生。</p> : (
              <ul className="space-y-2">
                {viewing.students.map((student) => {
                  const unusual = followUpStatuses.has(student.attendanceStatus);
                  return (
                  <li key={student.id} className="flex items-center justify-between gap-3 rounded-xl bg-[#f7faf8] px-3 py-2">
                    {unusual ? (
                      <button type="button" className="font-bold text-[var(--teal)]" onClick={() => setAttendanceDetail(student)}>{student.name}</button>
                    ) : <span className="font-bold">{student.name}</span>}
                    <span className="flex items-center gap-3 text-xs">
                      <span className="relative" onClick={() => setMessage("考勤由授课教师记录，负责人无权修改。")}>
                        <select value={student.attendanceStatus} disabled className="pointer-events-none rounded-[10px] border border-[var(--line)] bg-[#f4f6f5] px-2 py-1 text-xs text-[#74838b]">
                          {(Object.keys(attendanceLabel) as Array<keyof typeof attendanceLabel>).map((status) => (
                            <option key={status} value={status}>{attendanceLabel[status]}</option>
                          ))}
                        </select>
                      </span>
                      {unusual ? (
                        <button type="button" className={attendanceTone[student.attendanceStatus]} onClick={() => setAttendanceDetail(student)}>{attendanceLabel[student.attendanceStatus]}</button>
                      ) : null}
                      {viewing.status !== "CANCELLED" ? (
                        <button type="button" className="font-bold text-[#9a6729]" onClick={() => setRemoving({ id: student.id, name: student.name, marked: student.attendanceStatus !== "NOT_MARKED" })}>移出</button>
                      ) : null}
                    </span>
                  </li>
                  );
                })}
              </ul>
            )}
            {viewing.status !== "CANCELLED" ? (
              <form key={viewing.id} onSubmit={changeTeacher} className="grid gap-2 rounded-xl border border-[var(--line)] p-3">
                <label className="grid gap-1.5 text-xs font-bold">
                  更换教师
                  <select
                    name="teacherId"
                    defaultValue={viewing.teacherId}
                    onChange={() => setTeacherWarning("")}
                    className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]"
                  >
                    {teachers.map((teacher) => (
                      <option key={teacher.id} value={teacher.id}>{teacher.name}{teacher.linked ? "" : " · 未关联账号"}</option>
                    ))}
                  </select>
                  <FieldError message={fieldErrors.teacherId} />
                </label>
                {teacherWarning ? (
                  <>
                    <input type="hidden" name="acknowledgeConflict" value="1" />
                    <p className="rounded-xl bg-[#fff2df] px-3 py-3 text-xs leading-6 text-[#9a6729]">{teacherWarning}</p>
                  </>
                ) : null}
                <div className="flex justify-end">
                  <button disabled={pending} className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold disabled:opacity-60">
                    {pending ? "正在保存…" : teacherWarning ? "仍然更换" : "保存教师"}
                  </button>
                </div>
              </form>
            ) : null}
            {message ? <p className="text-xs text-[#b94d4d]">{message}</p> : null}
            <div className="flex justify-end gap-2">
              {viewing.status === "SCHEDULED" ? (
                <button type="button" onClick={() => setCancelling(viewing)} className="rounded-[10px] bg-[#c27b35] px-3.5 py-2.5 text-xs font-bold text-white">取消课次</button>
              ) : null}
              <button type="button" onClick={() => setViewing(null)} className="rounded-[10px] border border-[var(--line)] px-3.5 py-2.5 text-xs font-bold">关闭</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {removing ? (
        <Modal title={removing.marked ? "移出已考勤学生" : "移出学生"} onClose={() => { if (!pending) setRemoving(null); }}>
          <div className="px-5 py-5 text-sm leading-7 text-[var(--muted)]">
            {removing.marked
              ? "该学生已记录考勤，移除后可能影响其课时和考勤统计。如果确定要移除，系统将同步撤销其考勤并退回课时，是否继续？"
              : "确认将该学生移出本节课名单吗？"}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={pending} onClick={() => setRemoving(null)} className="rounded-[10px] border border-[var(--line)] px-3.5 py-2.5 text-xs font-bold">取消</button>
              <button type="button" disabled={pending} onClick={confirmRemove} className={`rounded-[10px] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60 ${removing.marked ? "bg-[#b94d4d]" : "bg-[var(--teal)]"}`}>
                {pending ? "正在移出…" : "确认移出"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {attendanceDetail ? (
        <Modal title="考勤详情" onClose={() => setAttendanceDetail(null)}>
          <div className="space-y-3 px-5 py-5 text-sm">
            <div><div className="text-xs font-bold">学生姓名</div><p className="mt-1">{attendanceDetail.name}</p></div>
            <div><div className="text-xs font-bold">年级</div><p className="mt-1 text-[var(--muted)]">{attendanceDetail.grade ?? "未填写"}</p></div>
            <div><div className="text-xs font-bold">年龄</div><p className="mt-1 text-[var(--muted)]">{attendanceDetail.age ? `${attendanceDetail.age}岁` : "未填写"}</p></div>
            <div><div className="text-xs font-bold">考勤状态</div><p className={`mt-1 ${attendanceTone[attendanceDetail.attendanceStatus] ?? ""}`}>{attendanceLabel[attendanceDetail.attendanceStatus]}</p></div>
            <div><div className="text-xs font-bold">备注原因</div><p className="mt-1 leading-6 text-[var(--muted)]">{attendanceDetail.attendanceNote?.trim() || "老师没有填写备注。"}</p></div>
            <div><div className="text-xs font-bold">家长联系方式</div><p className="mt-1 leading-6 text-[var(--muted)]">{attendanceDetail.parentContact}</p></div>
            <div className="flex justify-end">
              <button type="button" onClick={() => setAttendanceDetail(null)} className="rounded-[10px] border border-[var(--line)] px-3.5 py-2.5 text-xs font-bold">关闭</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {cancelling ? (
        <Modal title="取消课次" onClose={() => setCancelling(null)}>
          <div className="px-5 py-5 text-sm leading-7 text-[var(--muted)]">
            取消后「{cancelling.title}」仍会留在课表里。学生名单和考勤记录保留，已经扣掉的课时会退回。
            {message ? <p className="mt-3 text-xs text-[#b94d4d]">{message}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setCancelling(null)} className="rounded-[10px] border border-[var(--line)] px-3.5 py-2.5 text-xs font-bold">返回</button>
              <button type="button" disabled={pending} onClick={cancel} className="rounded-[10px] bg-[#c27b35] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">
                {pending ? "正在取消…" : "确认取消"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
