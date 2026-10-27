"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState, useTransition } from "react";
import { archiveClassGroup, archiveCourse, createClassGroup, createCourse, restoreClassGroup, restoreCourse, updateClassGroup, updateCourse, type FieldErrors } from "@/app/owner/courses/actions";
import { ClassWaitlistButton, type WaitEntry, type WaitStudent } from "@/components/class-waitlist";
import { FieldError, TextField } from "@/components/form-fields";
import { usePick } from "@/components/locale-provider";
import { Modal } from "@/components/modal";

export type CourseOption = { id: string; name: string };
export type TeacherOption = { id: string; name: string };

export type CourseRow = {
  id: string;
  name: string;
  category: "ACADEMIC" | "ART" | "EARLY_CHILDHOOD" | "OTHER" | null;
  description: string | null;
  billingType: "PER_LESSON" | "PER_PERIOD";
  status: "ACTIVE" | "ARCHIVED";
};

export type ClassRow = {
  id: string;
  name: string;
  courseId: string;
  courseName: string;
  teacherId: string;
  teacherName: string;
  capacity: number | null;
  enrolledCount: number;
  enrolledStudentIds: string[];
  full: boolean;
  overCapacity: boolean;
  waitlist: WaitEntry[];
  hasLessons: boolean;
  status: "ACTIVE" | "ARCHIVED";
};

const billingLabels: Record<CourseRow["billingType"], string> = {
  PER_LESSON: "按课时",
  PER_PERIOD: "按周期",
};

const categoryLabels: Record<NonNullable<CourseRow["category"]>, string> = {
  ACADEMIC: "学科",
  ART: "艺术",
  EARLY_CHILDHOOD: "早教",
  OTHER: "其他",
};

export function CourseDirectory({
  courses,
  classes,
  courseOptions,
  teacherOptions,
  students,
  openClassId = "",
  openFormKey = "",
}: {
  courses: CourseRow[];
  classes: ClassRow[];
  courseOptions: CourseOption[];
  teacherOptions: TeacherOption[];
  students: WaitStudent[];
  openClassId?: string;
  openFormKey?: string;
}) {
  const router = useRouter();
  const t = usePick();
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState<"course" | "class" | null>(null);
  const [archiving, setArchiving] = useState<{ kind: "course" | "class"; id: string; name: string } | null>(null);
  const [editing, setEditing] = useState<CourseRow | null>(null);
  const [editingClass, setEditingClass] = useState<ClassRow | null>(null);
  const [confirmTeacherChange, setConfirmTeacherChange] = useState<FormData | null>(null);
  const [confirmCapacityShrink, setConfirmCapacityShrink] = useState<FormData | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  useEffect(() => {
    if (!openClassId) return;
    document.getElementById(`class-${openClassId}`)?.scrollIntoView({ block: "start" });
  }, [openClassId]);

  useEffect(() => {
    if (openFormKey.startsWith("course")) setCreating("course");
    if (openFormKey.startsWith("class")) setCreating("class");
  }, [openFormKey]);

  function saveCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setMessage("");
    setFieldErrors({});
    startTransition(async () => {
      const result = await createCourse(formData);
      if (!result.ok) {
        setMessage(result.message ?? "");
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      setCreating(null);
      router.refresh();
    });
  }

  function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setMessage("");
    setFieldErrors({});
    startTransition(async () => {
      const result = await updateCourse(formData);
      if (!result.ok) {
        setMessage(result.message ?? "");
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      setEditing(null);
      router.refresh();
    });
  }

  function commitClassEdit(formData: FormData, acknowledgeCapacityShrink = false) {
    if (acknowledgeCapacityShrink) formData.set("acknowledgeCapacityShrink", "1");
    setMessage("");
    setFieldErrors({});
    startTransition(async () => {
      const result = await updateClassGroup(formData);
      if (!result.ok) {
        if (result.needsCapacityConfirm) {
          setConfirmCapacityShrink(formData);
          setMessage(result.message ?? "");
          return;
        }
        setMessage(result.message ?? "");
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      setConfirmTeacherChange(null);
      setConfirmCapacityShrink(null);
      setEditingClass(null);
      router.refresh();
    });
  }

  function saveClassEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingClass) return;
    const formData = new FormData(event.currentTarget);
    const teacherId = String(formData.get("teacherId") ?? "");
    if (editingClass.hasLessons && teacherId !== editingClass.teacherId) {
      setConfirmTeacherChange(formData);
      return;
    }
    commitClassEdit(formData);
  }

  function saveClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setMessage("");
    setFieldErrors({});
    startTransition(async () => {
      const result = await createClassGroup(formData);
      if (!result.ok) {
        setMessage(result.message ?? "");
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      setCreating(null);
      router.refresh();
    });
  }

  function archive() {
    if (!archiving) return;
    setMessage("");
    startTransition(async () => {
      const result = archiving.kind === "course" ? await archiveCourse(archiving.id) : await archiveClassGroup(archiving.id);
      if (!result.ok) {
        setMessage(result.message ?? "归档失败。");
        return;
      }
      setArchiving(null);
      router.refresh();
    });
  }

  function restore(kind: "course" | "class", id: string) {
    setMessage("");
    startTransition(async () => {
      const result = kind === "course" ? await restoreCourse(id) : await restoreClassGroup(id);
      if (!result.ok) {
        setMessage(result.message ?? "恢复失败。");
        return;
      }
      router.refresh();
    });
  }

  const visibleCourses = courses.filter((course) => showArchived || course.status === "ACTIVE");
  const visibleClasses = classes.filter((item) => showArchived || item.status === "ACTIVE");

  return (
    <section className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">{t("课程与班级", "Courses")}</h1>
          <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">{t("课程是机构自己定义的类型。班级挂在课程下，并指定一名主讲教师。", "A course is a type you define. A class belongs to a course and has one main teacher.")}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setCreating("course");
            setFieldErrors({});
            setMessage("");
          }}
          className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white"
        >
          ＋ 创建课程
        </button>
      </div>

      <label className="flex w-fit items-center gap-2 text-xs font-bold text-[#385058]">
        <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} className="accent-[var(--teal)]" />
        显示已归档
      </label>
      {message ? <p className="text-xs text-[#b94d4d]">{message}</p> : null}

      <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse text-left text-xs">
            <thead className="bg-[#fafbf9] text-[10px] tracking-wide text-[#84918e]">
              <tr>
                <th className="px-4 py-3 font-extrabold">课程</th>
                <th className="px-4 py-3 font-extrabold">类别</th>
                <th className="px-4 py-3 font-extrabold">计费</th>
                <th className="px-4 py-3 font-extrabold">说明</th>
                <th className="px-4 py-3 font-extrabold">状态</th>
                <th className="px-4 py-3 font-extrabold">操作</th>
              </tr>
            </thead>
            <tbody>
              {visibleCourses.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center leading-7 text-[var(--muted)]">
                    {courses.length === 0 ? "还没有课程。可以先创建一门课程，再创建班级。" : "没有启用中的课程。勾选「显示已归档」可以查看已归档的课程。"}
                  </td>
                </tr>
              ) : (
                visibleCourses.map((course) => (
                  <tr key={course.id} className="border-t border-[#eef1ee]">
                    <td className="px-4 py-4 font-bold">{course.name}</td>
                    <td className="px-4 py-4 text-[var(--muted)]">{course.category ? categoryLabels[course.category] : "未分类"}</td>
                    <td className="px-4 py-4">{billingLabels[course.billingType]}</td>
                    <td className="px-4 py-4 text-[var(--muted)]">{course.description ?? "—"}</td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${course.status === "ACTIVE" ? "bg-[#edf5f1] text-[#34725d]" : "bg-[#eef1ee] text-[#74838b]"}`}>
                        {course.status === "ACTIVE" ? "启用中" : "已归档"}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span className="flex gap-3">
                        <button type="button" className="font-bold text-[var(--teal)]" onClick={() => { setEditing(course); setFieldErrors({}); setMessage(""); }}>编辑</button>
                        {course.status === "ACTIVE" ? (
                          <button type="button" className="font-bold text-[#9a6729]" onClick={() => setArchiving({ kind: "course", id: course.id, name: course.name })}>
                            归档
                          </button>
                        ) : (
                          <button type="button" disabled={pending} className="font-bold text-[var(--teal)] disabled:opacity-60" onClick={() => restore("course", course.id)}>
                            恢复
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <h2 className="text-lg font-semibold">班级</h2>
          <label className="flex items-center gap-2 text-xs font-bold text-[#385058]">
            <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} className="accent-[var(--teal)]" />
            显示已归档
          </label>
        </div>
        <button
          type="button"
          onClick={() => {
            setCreating("class");
            setFieldErrors({});
            setMessage("");
          }}
          className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white"
        >
          ＋ 创建班级
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-xs">
            <thead className="bg-[#fafbf9] text-[10px] tracking-wide text-[#84918e]">
              <tr>
                <th className="px-4 py-3 font-extrabold">班级</th>
                <th className="px-4 py-3 font-extrabold">所属课程</th>
                <th className="px-4 py-3 font-extrabold">主讲教师</th>
                <th className="px-4 py-3 font-extrabold">容量</th>
                <th className="px-4 py-3 font-extrabold">状态</th>
                <th className="px-4 py-3 font-extrabold">操作</th>
              </tr>
            </thead>
            <tbody>
              {visibleClasses.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center leading-7 text-[var(--muted)]">
                    {classes.length === 0 ? "还没有班级。创建时需要从已有课程和在职教师中选择。" : "没有启用中的班级。勾选「显示已归档」可以查看已归档的班级。"}
                  </td>
                </tr>
              ) : (
                visibleClasses.map((item) => (
                  <tr id={`class-${item.id}`} key={item.id} className="scroll-mt-24 border-t border-[#eef1ee]">
                    <td className="px-4 py-4 font-bold">{item.name}</td>
                    <td className="px-4 py-4">{item.courseName}</td>
                    <td className="px-4 py-4">{item.teacherName}</td>
                    <td className="px-4 py-4 text-[var(--muted)]">
                      <span>{item.capacity == null ? "不限" : `${item.enrolledCount} / ${item.capacity}`}</span>
                      {item.overCapacity ? <span className="ml-2 rounded-full bg-[#fff0ed] px-2 py-1 text-[10px] font-bold text-[#b94d4d]">超员</span> : item.full ? <span className="ml-2 rounded-full bg-[#fff2df] px-2 py-1 text-[10px] font-bold text-[#9a6729]">已满</span> : null}
                    </td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${item.status === "ACTIVE" ? "bg-[#edf5f1] text-[#34725d]" : "bg-[#eef1ee] text-[#74838b]"}`}>
                        {item.status === "ACTIVE" ? "启用中" : "已归档"}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      {item.status === "ACTIVE" ? (
                        <span className="flex gap-3">
                          <button type="button" className="font-bold text-[var(--teal)]" onClick={() => { setEditingClass(item); setFieldErrors({}); setMessage(""); }}>编辑</button>
                          <ClassWaitlistButton classId={item.id} className={item.name} full={item.full} enrolled={item.enrolledCount} capacity={item.capacity} entries={item.waitlist} students={students} enrolledStudentIds={item.enrolledStudentIds} startOpen={openClassId === item.id} />
                          <button type="button" className="font-bold text-[#9a6729]" onClick={() => setArchiving({ kind: "class", id: item.id, name: item.name })}>
                            归档
                          </button>
                        </span>
                      ) : (
                        <button type="button" disabled={pending} className="font-bold text-[var(--teal)] disabled:opacity-60" onClick={() => restore("class", item.id)}>
                          恢复
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {creating === "course" ? (
        <Modal title="创建课程" onClose={() => setCreating(null)}>
          <form onSubmit={saveCourse} className="px-5 py-5">
            <div className="grid gap-3">
              <TextField label="课程名称" name="name" required placeholder="例如：初中数学" error={fieldErrors.name} />
              <label className="grid gap-1.5 text-xs font-bold">
                类别
                <select name="category" defaultValue="" className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]">
                  <option value="">不分类</option>
                  <option value="ACADEMIC">学科</option>
                  <option value="ART">艺术</option>
                  <option value="EARLY_CHILDHOOD">早教</option>
                  <option value="OTHER">其他</option>
                </select>
              </label>
              <label className="grid gap-1.5 text-xs font-bold">
                计费模式 <span className="font-medium text-[#9a6729]">必填</span>
                <select name="billingType" defaultValue="PER_LESSON" className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]">
                  <option value="PER_LESSON">按课时</option>
                  <option value="PER_PERIOD">按周期</option>
                </select>
                <FieldError message={fieldErrors.billingType} />
              </label>
              <label className="grid gap-1.5 text-xs font-bold">
                说明
                <textarea name="description" rows={3} placeholder="选填" className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]" />
                <FieldError message={fieldErrors.description} />
              </label>
            </div>
            {message ? <p className="mt-3 text-xs text-[#b94d4d]">{message}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setCreating(null)} className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold">取消</button>
              <button disabled={pending} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">{pending ? "正在保存…" : "保存"}</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {editing ? (
        <Modal title="编辑课程" onClose={() => setEditing(null)}>
          <form key={editing.id} onSubmit={saveEdit} className="px-5 py-5">
            <input type="hidden" name="id" value={editing.id} />
            <div className="grid gap-3">
              <TextField label="课程名称" name="name" required defaultValue={editing.name} error={fieldErrors.name} />
              <label className="grid gap-1.5 text-xs font-bold">
                类别
                <select name="category" defaultValue={editing.category ?? ""} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]">
                  <option value="">不分类</option>
                  <option value="ACADEMIC">学科</option>
                  <option value="ART">艺术</option>
                  <option value="EARLY_CHILDHOOD">早教</option>
                  <option value="OTHER">其他</option>
                </select>
              </label>
              <label className="grid gap-1.5 text-xs font-bold">
                计费模式 <span className="font-medium text-[#9a6729]">必填</span>
                <select name="billingType" defaultValue={editing.billingType} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]">
                  <option value="PER_LESSON">按课时</option>
                  <option value="PER_PERIOD">按周期</option>
                </select>
                <FieldError message={fieldErrors.billingType} />
              </label>
              <label className="grid gap-1.5 text-xs font-bold">
                说明
                <textarea name="description" rows={3} defaultValue={editing.description ?? ""} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]" />
                <FieldError message={fieldErrors.description} />
              </label>
            </div>
            {message ? <p className="mt-3 text-xs text-[#b94d4d]">{message}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold">取消</button>
              <button disabled={pending} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">{pending ? "正在保存…" : "保存"}</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {editingClass ? (
        <Modal title="编辑班级" onClose={() => { setEditingClass(null); setConfirmTeacherChange(null); }}>
          <form key={editingClass.id} onSubmit={saveClassEdit} className="px-5 py-5">
            <input type="hidden" name="id" value={editingClass.id} />
            <div className="grid gap-3">
              <TextField label="班级名称" name="name" required defaultValue={editingClass.name} error={fieldErrors.name} />
              <label className="grid gap-1.5 text-xs font-bold">
                所属课程
                <select value={editingClass.courseId} disabled className="rounded-[10px] border border-[var(--line)] bg-[#f4f6f5] px-3 py-3 text-sm font-medium text-[#74838b]">
                  <option value={editingClass.courseId}>{editingClass.courseName}</option>
                </select>
              </label>
              <label className="grid gap-1.5 text-xs font-bold">
                主讲教师 <span className="font-medium text-[#9a6729]">必填</span>
                <select name="teacherId" defaultValue={editingClass.teacherId} required className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]">
                  {teacherOptions.some((teacher) => teacher.id === editingClass.teacherId) ? null : (
                    <option value={editingClass.teacherId}>{editingClass.teacherName}</option>
                  )}
                  {teacherOptions.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>{teacher.name}</option>
                  ))}
                </select>
                <FieldError message={fieldErrors.teacherId} />
              </label>
              <TextField label="容量" name="capacity" defaultValue={editingClass.capacity == null ? "" : String(editingClass.capacity)} placeholder="选填，例如 20" error={fieldErrors.capacity} />
            </div>
            {message ? <p className="mt-3 text-xs text-[#b94d4d]">{message}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setEditingClass(null)} className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold">取消</button>
              <button disabled={pending} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">
                {pending ? "正在保存…" : "保存"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {confirmCapacityShrink ? (
        <Modal title="容量小于在读人数" onClose={() => setConfirmCapacityShrink(null)}>
          <div className="px-5 py-5 text-sm leading-7 text-[var(--muted)]">
            {message || "容量会小于当前在读人数，班级将显示超员，排队也不能再转入。"}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmCapacityShrink(null)} className="rounded-[10px] border border-[var(--line)] px-3.5 py-2.5 text-xs font-bold">取消</button>
              <button type="button" disabled={pending} onClick={() => commitClassEdit(confirmCapacityShrink, true)} className="rounded-[10px] bg-[#c27b35] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">
                {pending ? "正在保存…" : "仍要改容量"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {confirmTeacherChange ? (
        <Modal title="修改主讲教师" onClose={() => setConfirmTeacherChange(null)}>
          <div className="px-5 py-5 text-sm leading-7 text-[var(--muted)]">
            该班级已有排课记录，修改主讲教师只影响未来新建的课次，不会更改历史课次。
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmTeacherChange(null)} className="rounded-[10px] border border-[var(--line)] px-3.5 py-2.5 text-xs font-bold">取消</button>
              <button type="button" disabled={pending} onClick={() => commitClassEdit(confirmTeacherChange)} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">
                {pending ? "正在保存…" : "继续保存"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {creating === "class" ? (
        <Modal title="创建班级" onClose={() => setCreating(null)}>
          <form onSubmit={saveClass} className="px-5 py-5">
            <div className="grid gap-3">
              <TextField label="班级名称" name="name" required placeholder="例如：初二数学 A 班" error={fieldErrors.name} />
              <label className="grid gap-1.5 text-xs font-bold">
                所属课程 <span className="font-medium text-[#9a6729]">必填</span>
                <select name="courseId" defaultValue="" required className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]">
                  <option value="">请选择课程</option>
                  {courseOptions.map((course) => (
                    <option key={course.id} value={course.id}>{course.name}</option>
                  ))}
                </select>
                <FieldError message={fieldErrors.courseId} />
              </label>
              <label className="grid gap-1.5 text-xs font-bold">
                主讲教师 <span className="font-medium text-[#9a6729]">必填</span>
                <select name="teacherId" defaultValue="" required className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]">
                  <option value="">请选择教师</option>
                  {teacherOptions.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>{teacher.name}</option>
                  ))}
                </select>
                <FieldError message={fieldErrors.teacherId} />
              </label>
              <TextField label="容量" name="capacity" placeholder="选填，例如 20" error={fieldErrors.capacity} />
            </div>
            {courseOptions.length === 0 || teacherOptions.length === 0 ? (
              <p className="mt-3 text-xs leading-6 text-[#9a6729]">
                {courseOptions.length === 0 ? "当前没有启用中的课程。" : ""}
                {teacherOptions.length === 0 ? "当前没有在职教师。" : ""}
              </p>
            ) : null}
            {message ? <p className="mt-3 text-xs text-[#b94d4d]">{message}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setCreating(null)} className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold">取消</button>
              <button disabled={pending || courseOptions.length === 0 || teacherOptions.length === 0} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">
                {pending ? "正在保存…" : "保存"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {archiving ? (
        <Modal title={archiving.kind === "course" ? "归档课程" : "归档班级"} onClose={() => setArchiving(null)}>
          <div className="px-5 py-5 text-sm leading-7 text-[var(--muted)]">
            归档后不会删除「{archiving.name}」。已有记录会保留，新建班级时不再列出已归档课程。
            {message ? <p className="mt-3 text-xs text-[#b94d4d]">{message}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setArchiving(null)} className="rounded-[10px] border border-[var(--line)] px-3.5 py-2.5 text-xs font-bold">取消</button>
              <button type="button" disabled={pending} onClick={archive} className="rounded-[10px] bg-[#c27b35] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">
                {pending ? "正在归档…" : "确认归档"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
