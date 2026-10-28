"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";
import {
  convertAbsentToLeaveForMakeup,
  saveAttendance,
  scheduleTeacherMakeup,
} from "@/app/teacher/actions";
import { DateField } from "@/components/date-field";
import { LessonFlow } from "@/components/lesson-flow";
import type { TeacherLesson } from "@/components/teacher-schedule";
import {
  combinedClassHintCounts,
  initialDeskDraft,
  markRemainingPresentDraft,
  syncDeskDraftFromLesson,
  type DeskDraft,
} from "@/lib/attendance-desk";
import { attendanceProgress } from "@/lib/teacher-lesson-map";
import {
  attendanceUiOptions,
  leaveBadgeClass,
  leaveKindLabel,
  toAttendanceUi,
  type AttendanceUiValue,
} from "@/lib/leave-kind";
import { lessonStatusLabel } from "@/lib/lesson-labels";

type Draft = DeskDraft;
type MakeupOption = { id: string; courseId: string; label: string };
type Tab = "today" | "pending" | "day";
type ListFilter = "all" | "unmarked" | "odd";

const quickStatuses: { value: AttendanceUiValue; label: string; on: string; off: string }[] = [
  { value: "PRESENT", label: "出勤", on: "bg-[#34725d] text-white", off: "border border-[var(--line)] bg-white text-[#34725d]" },
  { value: "LATE", label: "迟到", on: "bg-[#9a6729] text-white", off: "border border-[var(--line)] bg-white text-[#9a6729]" },
  { value: "ABSENT", label: "缺勤", on: "bg-[#b94d4d] text-white", off: "border border-[var(--line)] bg-white text-[#b94d4d]" },
  { value: "PERSONAL", label: "事假", on: "bg-[#c27b35] text-white", off: "border border-[var(--line)] bg-white text-[#c27b35]" },
  { value: "SICK", label: "病假", on: "bg-[#74838b] text-white", off: "border border-[var(--line)] bg-white text-[#74838b]" },
];

function draftStats(students: TeacherLesson["students"], draft: Record<string, Draft>) {
  const counts = { unmarked: 0, present: 0, late: 0, absent: 0, leave: 0, total: 0 };
  for (const student of students) {
    if (student.inactive) continue;
    counts.total += 1;
    const status = draft[student.id]?.status ?? toAttendanceUi(student.attendanceStatus, student.leaveKind);
    if (status === "NOT_MARKED") counts.unmarked += 1;
    else if (status === "PRESENT") counts.present += 1;
    else if (status === "LATE") counts.late += 1;
    else if (status === "ABSENT") counts.absent += 1;
    else counts.leave += 1;
  }
  return counts;
}

export function TeacherAttendanceBoard({
  tab,
  date,
  today,
  previousDate,
  nextDate,
  dateLabel,
  lessons,
  openLesson,
  makeupOptions,
  linked,
}: {
  tab: Tab;
  date: string;
  today: string;
  previousDate: string;
  nextDate: string;
  dateLabel: string;
  lessons: TeacherLesson[];
  openLesson: TeacherLesson | null;
  makeupOptions: MakeupOption[];
  linked: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [query, setQuery] = useState("");
  const [listFilter, setListFilter] = useState<ListFilter>("all");
  const [message, setMessage] = useState("");
  const [leaveConvertFor, setLeaveConvertFor] = useState<string | null>(null);
  const [convertKind, setConvertKind] = useState<"PERSONAL" | "SICK">("SICK");
  const [forceMakeupSourceId, setForceMakeupSourceId] = useState<string | null>(null);

  const [deskEpoch, setDeskEpoch] = useState(0);

  useEffect(() => {
    if (!openLesson) {
      setDraft({});
      return;
    }
    setDraft(initialDeskDraft(openLesson.students));
    setQuery("");
    setListFilter("all");
    setMessage("");
    setLeaveConvertFor(null);
    setForceMakeupSourceId(null);
    setDeskEpoch(0);
  }, [openLesson?.id]);

  useEffect(() => {
    if (!openLesson || deskEpoch === 0) return;
    const fresh = lessons.find((lesson) => lesson.id === openLesson.id);
    if (!fresh) return;
    // 保存/转假后用最新课次名单重建草稿，避免界面仍显示缺勤。
    setDraft(syncDeskDraftFromLesson(fresh.students));
  }, [lessons, openLesson?.id, deskEpoch]);

  const liveLesson = openLesson ? lessons.find((lesson) => lesson.id === openLesson.id) ?? openLesson : null;
  const stats = liveLesson ? draftStats(liveLesson.students, draft) : null;
  const seatHint = liveLesson ? combinedClassHintCounts(liveLesson.students) : { guest: 0, converted: 0, trial: 0 };

  const visibleStudents = useMemo(() => {
    if (!liveLesson) return [];
    const text = query.trim().toLowerCase();
    return liveLesson.students
      .filter((student) => {
        if (text && !student.name.toLowerCase().includes(text)) return false;
        const status = draft[student.id]?.status ?? toAttendanceUi(student.attendanceStatus, student.leaveKind);
        if (listFilter === "unmarked") return student.attendanceStatus === "NOT_MARKED" && (status === "PRESENT" || status === "NOT_MARKED");
        if (listFilter === "odd") return status === "ABSENT" || status === "LATE" || status === "PERSONAL" || status === "SICK";
        return true;
      })
      .sort((left, right) => {
        const leftOpen = left.attendanceStatus === "NOT_MARKED" ? 0 : left.attendanceStatus === "ABSENT" ? 1 : 2;
        const rightOpen = right.attendanceStatus === "NOT_MARKED" ? 0 : right.attendanceStatus === "ABSENT" ? 1 : 2;
        if (leftOpen !== rightOpen) return leftOpen - rightOpen;
        return left.name.localeCompare(right.name, "zh");
      });
  }, [liveLesson, draft, query, listFilter]);

  function setStatus(studentId: string, status: AttendanceUiValue) {
    setDraft((current) => ({
      ...current,
      [studentId]: { status, note: current[studentId]?.note ?? "" },
    }));
  }

  function markAllPresent() {
    if (!liveLesson) return;
    setDraft((current) => {
      const next = { ...current };
      for (const student of liveLesson.students) {
        if (student.inactive) continue;
        const prior = next[student.id] ?? {
          status: toAttendanceUi(student.attendanceStatus, student.leaveKind),
          note: student.attendanceNote ?? "",
        };
        if (student.parentLeave || prior.status === "PERSONAL" || prior.status === "SICK" || student.attendanceStatus === "LEAVE") {
          next[student.id] = {
            ...prior,
            status: prior.status === "SICK" || student.leaveKind === "SICK" ? "SICK" : "PERSONAL",
          };
          continue;
        }
        next[student.id] = { ...prior, status: "PRESENT" };
      }
      return next;
    });
  }

  function markRemainingPresent() {
    if (!liveLesson) return;
    setDraft((current) => markRemainingPresentDraft(liveLesson.students, current));
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!liveLesson || liveLesson.status === "CANCELLED") return;
    const formData = new FormData();
    for (const student of liveLesson.students) {
      if (student.inactive) continue;
      const row = draft[student.id];
      if (!row) continue;
      formData.set(`status:${student.id}`, row.status);
      formData.set(`note:${student.id}`, row.note);
    }
    setMessage("");
    startTransition(async () => {
      const result = await saveAttendance(liveLesson.id, formData);
      setMessage(result.message ?? (result.ok ? "签到已保存。" : "保存失败。"));
      if (result.ok) {
        setDeskEpoch((value) => value + 1);
        router.refresh();
      }
    });
  }

  function runConvertToLeave(lessonStudentId: string) {
    const data = new FormData();
    data.set("leaveKind", convertKind);
    setMessage("");
    startTransition(async () => {
      const result = await convertAbsentToLeaveForMakeup(lessonStudentId, data);
      setMessage(result.message ?? "");
      if (result.ok && result.sourceId) {
        setLeaveConvertFor(null);
        setForceMakeupSourceId(result.sourceId);
        setDeskEpoch((value) => value + 1);
        router.refresh();
      }
    });
  }

  if (!linked) {
    return (
      <section>
        <h1 className="text-[28px] font-semibold tracking-tight">学生签到</h1>
        <p className="mt-4 rounded-2xl border border-[var(--line)] bg-white px-5 py-10 text-center text-sm text-[var(--muted)]">当前账号还没有关联在职教师档案，不能签到。</p>
      </section>
    );
  }

  if (liveLesson) {
    const canEdit = liveLesson.status !== "CANCELLED";
    return (
      <section className="pb-28">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href={tabHref(tab, date)} className="text-xs font-bold text-[var(--teal)]">← 返回签到列表</Link>
            <h1 className="mt-2 text-[28px] font-semibold tracking-tight">学生签到</h1>
            <p className="mt-1 text-sm font-bold">{liveLesson.title}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {liveLesson.dateLabel} {liveLesson.startLabel}–{liveLesson.endLabel} · {liveLesson.courseName} · {liveLesson.className}
              {liveLesson.location ? ` · ${liveLesson.location}` : ""}
              {liveLesson.status === "CANCELLED" ? ` · ${lessonStatusLabel.CANCELLED}` : ""}
            </p>
          </div>
          <Link href={`/teacher/schedule?view=day&date=${liveLesson.dateKey}&lesson=${liveLesson.id}`} className="text-xs font-bold text-[#74838b]">在课表中查看</Link>
        </div>

        {liveLesson.overClassCapacity || liveLesson.overRoomCapacity ? (
          <p className="mt-3 rounded-xl bg-[#fff0ed] px-3 py-2 text-xs leading-5 text-[#b94d4d]">
            {liveLesson.overClassCapacity ? `班级容量 ${liveLesson.classCapacity} 人，名单 ${liveLesson.students.length} 人，已超员。` : ""}
            {liveLesson.overRoomCapacity ? ` 教室可坐 ${liveLesson.roomCapacity} 人，已超过教室容量。` : ""}
            合班或加人后仍可签到保存。
          </p>
        ) : null}

        {seatHint.guest > 0 || seatHint.converted > 0 || seatHint.trial > 0 ? (
          <p className="mt-3 rounded-xl bg-[#f4faf7] px-3 py-2 text-xs leading-5 text-[#34725d]">
            本课共 {liveLesson.students.length} 人
            {seatHint.guest > 0 ? `，合班/跨班临时 ${seatHint.guest} 人` : ""}
            {seatHint.converted > 0 ? `，已转正 ${seatHint.converted} 人` : ""}
            {seatHint.trial > 0 ? `，试听 ${seatHint.trial} 人` : ""}
            。大班建议先「一键全勤」，再改缺勤与请假。
          </p>
        ) : null}

        {canEdit ? <LessonFlow lessonId={liveLesson.id} dateKey={liveLesson.dateKey} current="attendance" /> : null}

        {stats ? (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              { label: "应到", value: stats.total },
              { label: "出勤", value: stats.present, tone: "text-[#34725d]" },
              { label: "迟到", value: stats.late, tone: "text-[#9a6729]" },
              { label: "缺勤", value: stats.absent, tone: "text-[#b94d4d]" },
              { label: "请假", value: stats.leave, tone: "text-[#c27b35]" },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-[var(--line)] bg-white px-3 py-3">
                <div className="text-[10px] font-extrabold tracking-wide text-[#84918e]">{item.label}</div>
                <div className={`mt-1 text-xl font-semibold ${item.tone ?? ""}`}>{item.value}</div>
              </div>
            ))}
          </div>
        ) : null}

        <form onSubmit={save} className="mt-4">
          <div className="sticky top-0 z-10 -mx-1 space-y-2 bg-[var(--bg)] px-1 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索姓名（大班快速定位）"
                className="min-w-[200px] flex-1 rounded-[10px] border border-[var(--line)] bg-white px-3 py-2.5 text-sm outline-none focus:border-[var(--teal)]"
              />
              {canEdit ? (
                <>
                  <button type="button" onClick={markAllPresent} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2.5 text-xs font-bold">一键全勤</button>
                  <button type="button" onClick={markRemainingPresent} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2.5 text-xs font-bold">未点的标出勤</button>
                </>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["all", "全部"],
                  ["unmarked", "待确认"],
                  ["odd", "异常"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setListFilter(id)}
                  className={`rounded-full px-3 py-1.5 text-xs font-bold ${listFilter === id ? "bg-[var(--teal)] text-white" : "border border-[var(--line)] bg-white text-[#385058]"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {canEdit ? (
              <p className="text-[11px] leading-5 text-[var(--muted)]">
                打开签到台时，未标记会先预选为出勤，保存后才扣课时。事假/病假不会被一键全勤覆盖。缺勤可转请假并补课。
              </p>
            ) : null}
          </div>

          {liveLesson.students.length === 0 ? (
            <p className="mt-6 rounded-2xl border border-[var(--line)] bg-white px-5 py-10 text-center text-sm text-[var(--muted)]">这节课没有学生名单。</p>
          ) : visibleStudents.length === 0 ? (
            <p className="mt-6 text-sm text-[var(--muted)]">没有符合筛选的学生。</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {visibleStudents.map((student) => {
                const locked = !canEdit || student.inactive;
                const row = draft[student.id] ?? {
                  status: toAttendanceUi(student.attendanceStatus, student.leaveKind),
                  note: student.attendanceNote ?? "",
                };
                const showMakeup = student.canMakeup || forceMakeupSourceId === student.lessonStudentId;
                return (
                  <li key={student.id} className="rounded-2xl border border-[var(--line)] bg-white p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold">{student.name}</span>
                      {student.parentLeave ? <span className="rounded-full bg-[#fff2df] px-2 py-0.5 text-[10px] font-bold text-[#9a6729]">家长已请假</span> : null}
                      {student.attendanceStatus === "LEAVE" ? (
                        <span className={leaveBadgeClass(student.leaveKind)}>{student.leaveKind === "SICK" ? leaveKindLabel.SICK : leaveKindLabel.PERSONAL}</span>
                      ) : null}
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${student.seat === "TRIAL" ? "bg-[#e7eefb] text-[#24548f]" : student.seat === "GUEST" || student.seat === "CONVERTED" ? "bg-[#fff2df] text-[#9a6729]" : "bg-[#eef1ee] text-[#51656a]"}`}>
                        {student.seatLabel}
                      </span>
                      <span className="text-[11px] font-bold text-[#24548f]">{student.usageText}</span>
                      {student.makeupText ? <span className="text-[11px] font-bold text-[#9a6729]">{student.makeupText}</span> : null}
                      {student.inactive ? <span className="rounded-full bg-[#eef1ee] px-2 py-0.5 text-[10px] font-bold text-[#74838b]">已停用</span> : null}
                      {student.attendanceStatus === "NOT_MARKED" ? <span className="rounded-full bg-[#edf5f1] px-2 py-0.5 text-[10px] font-bold text-[#34725d]">库中未标记</span> : null}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {quickStatuses.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          disabled={locked}
                          onClick={() => setStatus(student.id, option.value)}
                          className={`rounded-full px-3 py-1.5 text-xs font-bold disabled:opacity-40 ${row.status === option.value ? option.on : option.off}`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)]">
                      <select
                        value={row.status}
                        disabled={locked}
                        onChange={(event) => setStatus(student.id, event.target.value as AttendanceUiValue)}
                        className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-sm disabled:bg-[#f4f6f5]"
                      >
                        {attendanceUiOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                      <input
                        value={row.note}
                        disabled={locked}
                        placeholder="备注（可选）"
                        onChange={(event) => setDraft((current) => ({ ...current, [student.id]: { ...row, note: event.target.value } }))}
                        className="rounded-[10px] border border-[var(--line)] px-3 py-2 text-sm outline-none focus:border-[var(--teal)] disabled:bg-[#f4f6f5]"
                      />
                    </div>

                    {!locked && (student.attendanceStatus === "ABSENT" || row.status === "ABSENT") ? (
                      <div className="mt-2">
                        {leaveConvertFor === student.lessonStudentId ? (
                          <div className="grid gap-2 rounded-xl bg-[#f7faf8] p-3">
                            <p className="text-[11px] text-[var(--muted)]">转为请假会退回已扣课时（若有），再选补课。默认病假。</p>
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
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {forceMakeupSourceId === student.lessonStudentId ? <p className="w-full text-[11px] font-bold text-[#34725d]">已转为请假，请选择补课课次。</p> : null}
                        <select id={`att-makeup-${student.lessonStudentId}`} defaultValue="" className="min-w-[180px] flex-1 rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs">
                          <option value="">选择补课课次</option>
                          {makeupOptions.filter((option) => option.courseId === liveLesson.courseId && option.id !== liveLesson.id).map((option) => (
                            <option key={option.id} value={option.id}>{option.label}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => {
                            const targetLessonId = (document.getElementById(`att-makeup-${student.lessonStudentId}`) as HTMLSelectElement | null)?.value ?? "";
                            if (!targetLessonId) {
                              setMessage("请选择补课课次。");
                              return;
                            }
                            const data = new FormData();
                            data.set("targetLessonId", targetLessonId);
                            setMessage("");
                            startTransition(async () => {
                              const result = await scheduleTeacherMakeup(student.lessonStudentId, data);
                              setMessage(result.message ?? "");
                              if (result.ok) {
                                setForceMakeupSourceId(null);
                                router.refresh();
                              }
                            });
                          }}
                          className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold"
                        >
                          安排补课
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          {message ? <p className={`mt-4 text-xs ${message.includes("失败") || message.includes("不足") || message.includes("没有") ? "text-[#b94d4d]" : "text-[#34725d]"}`}>{message}</p> : null}

          {canEdit && liveLesson.students.some((student) => !student.inactive) ? (
            <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--line)] bg-white/95 px-4 py-3 backdrop-blur">
              <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-[var(--muted)]">
                  出勤 {stats?.present ?? 0} · 迟到 {stats?.late ?? 0} · 缺勤 {stats?.absent ?? 0} · 请假 {stats?.leave ?? 0}
                </p>
                <button disabled={pending} className="rounded-[10px] bg-[var(--teal)] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                  {pending ? "保存中…" : "保存签到"}
                </button>
              </div>
            </div>
          ) : null}
        </form>
      </section>
    );
  }

  return (
    <section>
      <h1 className="text-[28px] font-semibold tracking-tight">学生签到</h1>
      <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">
        按课次签到，适合大班与合班。未标记不会自动扣课时；打开签到台后可一键全勤，再改个别异常后保存。
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/teacher/attendance?tab=today" className={`rounded-full px-3 py-1.5 text-xs font-bold ${tab === "today" ? "bg-[var(--teal)] text-white" : "border border-[var(--line)] bg-white text-[#385058]"}`}>今日课次</Link>
        <Link href="/teacher/attendance?tab=pending" className={`rounded-full px-3 py-1.5 text-xs font-bold ${tab === "pending" ? "bg-[var(--teal)] text-white" : "border border-[var(--line)] bg-white text-[#385058]"}`}>待签到</Link>
        <Link href={`/teacher/attendance?tab=day&date=${date}`} className={`rounded-full px-3 py-1.5 text-xs font-bold ${tab === "day" ? "bg-[var(--teal)] text-white" : "border border-[var(--line)] bg-white text-[#385058]"}`}>按日期</Link>
      </div>

      {tab === "day" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link href={`/teacher/attendance?tab=day&date=${previousDate}`} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">前一天</Link>
          <form action="/teacher/attendance" className="flex items-center gap-2">
            <input type="hidden" name="tab" value="day" />
            <DateField name="date" defaultValue={date} className="w-40 rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold" />
            <button className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">查看</button>
          </form>
          <Link href={`/teacher/attendance?tab=day&date=${nextDate}`} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">后一天</Link>
          <span className="text-xs font-bold text-[#74838b]">{dateLabel}{date === today ? " · 今天" : ""}</span>
        </div>
      ) : null}

      {lessons.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-[var(--line)] bg-white px-5 py-12 text-center text-sm text-[var(--muted)]">
          {tab === "pending" ? "没有待签到的课次。已点完或还没排课。" : "这个范围内没有你的课。"}
        </p>
      ) : (
        <ul className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
          {lessons.map((lesson) => {
            const progress = attendanceProgress(lesson);
            const need = progress.unmarked > 0 && lesson.status !== "CANCELLED";
            return (
              <li key={lesson.id} className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3 border-b border-[#f0f2f0] px-4 py-4 last:border-b-0">
                <div className="text-xs font-extrabold">
                  {lesson.startLabel}
                  <small className="mt-1 block font-medium text-[var(--muted)]">{lesson.endLabel}</small>
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold">{lesson.courseName} · {lesson.title}</div>
                  <div className="mt-1 text-[11px] text-[var(--muted)]">
                    {lesson.dateLabel} · {lesson.className} · {progress.total} 人
                    {lesson.location ? ` · ${lesson.location}` : ""}
                    {lesson.status === "CANCELLED" ? ` · ${lessonStatusLabel.CANCELLED}` : ""}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {need ? <span className="rounded-full bg-[#fff2df] px-2 py-0.5 text-[10px] font-bold text-[#9a6729]">待签 {progress.unmarked}</span> : <span className="rounded-full bg-[#edf5f1] px-2 py-0.5 text-[10px] font-bold text-[#34725d]">已签完</span>}
                    {progress.absent > 0 ? <span className="rounded-full bg-[#fdeeee] px-2 py-0.5 text-[10px] font-bold text-[#b94d4d]">缺勤 {progress.absent}</span> : null}
                    {progress.leave > 0 ? <span className="rounded-full bg-[#fff2df] px-2 py-0.5 text-[10px] font-bold text-[#c27b35]">请假 {progress.leave}</span> : null}
                  </div>
                </div>
                <Link
                  href={`/teacher/attendance?tab=${tab}&date=${lesson.dateKey}&lesson=${lesson.id}`}
                  className="shrink-0 rounded-[10px] bg-[var(--teal)] px-3 py-2 text-xs font-bold text-white"
                >
                  {lesson.status === "CANCELLED" ? "查看" : need ? "去签到" : "查看/改签"}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function tabHref(tab: Tab, date: string) {
  if (tab === "day") return `/teacher/attendance?tab=day&date=${date}`;
  if (tab === "pending") return "/teacher/attendance?tab=pending";
  return "/teacher/attendance?tab=today";
}
