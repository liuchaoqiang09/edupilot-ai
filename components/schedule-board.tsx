"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState, useTransition } from "react";
import { cancelLesson, createLesson, type FieldErrors } from "@/app/owner/schedule/actions";
import { FieldError, TextField } from "@/components/form-fields";
import { Modal } from "@/components/modal";
import { attendanceLabel, lessonStatusLabel } from "@/lib/lesson-labels";

export type ScheduleClassOption = {
  id: string;
  name: string;
  courseName: string;
  teacherId: string;
  teacherName: string;
};

export type ScheduleTeacherOption = { id: string; name: string; linked: boolean };
export type ScheduleStudentOption = { id: string; name: string; grade: string | null };

export type ScheduleLesson = {
  id: string;
  title: string;
  startLabel: string;
  endLabel: string;
  courseName: string;
  className: string;
  teacherName: string;
  location: string | null;
  status: keyof typeof lessonStatusLabel;
  students: { id: string; name: string; attendanceStatus: keyof typeof attendanceLabel; attendanceNote: string | null }[];
};

export function ScheduleBoard({
  date,
  previousDate,
  nextDate,
  dateLabel,
  lessons,
  classes,
  teachers,
  students,
}: {
  date: string;
  previousDate: string;
  nextDate: string;
  dateLabel: string;
  lessons: ScheduleLesson[];
  classes: ScheduleClassOption[];
  teachers: ScheduleTeacherOption[];
  students: ScheduleStudentOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<ScheduleLesson | null>(null);
  const [cancelling, setCancelling] = useState<ScheduleLesson | null>(null);
  const [classId, setClassId] = useState(classes[0]?.id ?? "");
  const [teacherId, setTeacherId] = useState(classes[0]?.teacherId ?? "");
  const [message, setMessage] = useState("");
  const [warning, setWarning] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const selectedClass = useMemo(() => classes.find((item) => item.id === classId) ?? null, [classes, classId]);

  function openCreate() {
    const first = classes[0];
    setClassId(first?.id ?? "");
    setTeacherId(first?.teacherId ?? "");
    setFieldErrors({});
    setMessage("");
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
        return;
      }
      setWarning(result.warning ?? "");
      setCreating(false);
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
      router.refresh();
    });
  }

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">排课 / 课表</h1>
          <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">按日期查看课次。创建时选择班级，课程和主讲教师会自动带出，教师可以临时调整。</p>
        </div>
        <button type="button" onClick={openCreate} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white">
          ＋ 创建课次
        </button>
      </div>

      {warning ? <p className="mt-4 rounded-xl bg-[#fff2df] px-4 py-3 text-xs leading-6 text-[#9a6729]">{warning}</p> : null}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Link href={`/owner/schedule?date=${previousDate}`} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">前一天</Link>
        <form action="/owner/schedule" className="flex items-center gap-2">
          <input type="date" name="date" defaultValue={date} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold" />
          <button className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">查看</button>
        </form>
        <Link href={`/owner/schedule?date=${nextDate}`} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">后一天</Link>
        <span className="text-xs text-[var(--muted)]">{dateLabel}</span>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        {lessons.length === 0 ? (
          <p className="px-5 py-12 text-center leading-7 text-[var(--muted)]">这一天还没有课次。</p>
        ) : (
          <ul className="px-5">
            {lessons.map((lesson) => {
              const marked = lesson.students.filter((student) => student.attendanceStatus !== "NOT_MARKED").length;
              return (
                <li key={lesson.id} className="grid grid-cols-[64px_4px_minmax(0,1fr)_auto] items-center gap-3 border-b border-[#f0f2f0] py-4 last:border-b-0">
                  <div className="text-xs font-extrabold">
                    {lesson.startLabel}
                    <small className="mt-1 block font-medium text-[var(--muted)]">{lesson.endLabel}</small>
                  </div>
                  <div className={`h-10 w-1 rounded ${lesson.status === "CANCELLED" ? "bg-[#e7c2c2]" : "bg-[#91c8b5]"}`} />
                  <div className="min-w-0">
                    <div className="text-xs font-bold">{lesson.title}</div>
                    <div className="mt-1 text-[11px] text-[var(--muted)]">
                      {lesson.teacherName} · {lesson.students.length} 人 · 已标记 {marked} · {lesson.location ?? "地点待定"}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${lesson.status === "CANCELLED" ? "bg-[#fff0ed] text-[#b94d4d]" : "bg-[#edf5f1] text-[#34725d]"}`}>
                      {lessonStatusLabel[lesson.status]}
                    </span>
                    <button type="button" className="text-xs font-bold text-[var(--teal)]" onClick={() => setViewing(lesson)}>查看</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {creating ? (
        <Modal title="创建课次" onClose={() => setCreating(false)}>
          <form onSubmit={save} className="px-5 py-5">
            <div className="grid gap-3">
              <label className="grid gap-1.5 text-xs font-bold">
                班级 *
                <select
                  name="classGroupId"
                  value={classId}
                  onChange={(event) => {
                    const next = classes.find((item) => item.id === event.target.value);
                    setClassId(event.target.value);
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
                主讲教师 *
                <select name="teacherId" value={teacherId} onChange={(event) => setTeacherId(event.target.value)} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]">
                  <option value="">请选择教师</option>
                  {teachers.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>{teacher.name}{teacher.linked ? " · 可登录查看" : " · 未关联账号"}</option>
                  ))}
                </select>
                <FieldError message={fieldErrors.teacherId} />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5 text-xs font-bold">
                  开始时间 *
                  <input type="datetime-local" name="startAt" required defaultValue={`${date}T16:00`} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]" />
                  <FieldError message={fieldErrors.startAt} />
                </label>
                <label className="grid gap-1.5 text-xs font-bold">
                  结束时间 *
                  <input type="datetime-local" name="endAt" required defaultValue={`${date}T17:30`} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]" />
                  <FieldError message={fieldErrors.endAt} />
                </label>
              </div>
              <TextField label="地点" name="location" placeholder="例如 A201" error={fieldErrors.location} />
              <fieldset className="grid gap-2">
                <legend className="text-xs font-bold">参加学生</legend>
                <p className="text-xs leading-6 text-[var(--muted)]">班级目前没有固定学员名单。请从本机构在读学生中勾选这节课实际参加的人。</p>
                <div className="max-h-40 space-y-2 overflow-y-auto rounded-xl border border-[var(--line)] p-3">
                  {students.length === 0 ? <p className="text-xs text-[var(--muted)]">还没有在读学生。</p> : null}
                  {students.map((student) => (
                    <label key={student.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="studentIds" value={student.id} className="accent-[var(--teal)]" />
                      <span className="font-bold">{student.name}</span>
                      <span className="text-xs text-[var(--muted)]">{student.grade ?? "未填写年级"}</span>
                    </label>
                  ))}
                </div>
                <FieldError message={fieldErrors.students} />
              </fieldset>
            </div>
            {message ? <p className="mt-3 text-xs text-[#b94d4d]">{message}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setCreating(false)} className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold">取消</button>
              <button disabled={pending || classes.length === 0} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">
                {pending ? "正在保存…" : "保存"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {viewing ? (
        <Modal title="课次详情" onClose={() => setViewing(null)}>
          <div className="space-y-3 px-5 py-5 text-sm">
            <div className="font-bold">{viewing.title}</div>
            <p className="text-[var(--muted)]">{viewing.startLabel} – {viewing.endLabel} · {viewing.teacherName} · {viewing.location ?? "地点待定"}</p>
            {viewing.students.length === 0 ? <p className="text-[var(--muted)]">这节课还没有学生。</p> : (
              <ul className="space-y-2">
                {viewing.students.map((student) => (
                  <li key={student.id} className="flex items-center justify-between rounded-xl bg-[#f7faf8] px-3 py-2">
                    <span className="font-bold">{student.name}</span>
                    <span className="text-xs text-[var(--muted)]">{attendanceLabel[student.attendanceStatus]}{student.attendanceNote ? ` · ${student.attendanceNote}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
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

      {cancelling ? (
        <Modal title="取消课次" onClose={() => setCancelling(null)}>
          <div className="px-5 py-5 text-sm leading-7 text-[var(--muted)]">
            取消后「{cancelling.title}」仍会留在课表里，学生名单和已有考勤不会删除。
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
