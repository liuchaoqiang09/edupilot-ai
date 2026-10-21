"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";
import { archiveClassGroup, archiveCourse, createClassGroup, createCourse, type FieldErrors } from "@/app/owner/courses/actions";
import { FieldError, TextField } from "@/components/form-fields";
import { Modal } from "@/components/modal";

export type CourseOption = { id: string; name: string };
export type TeacherOption = { id: string; name: string };

export type CourseRow = {
  id: string;
  name: string;
  category: "ACADEMIC" | "ART" | "EARLY_CHILDHOOD" | "OTHER" | null;
  description: string | null;
  status: "ACTIVE" | "ARCHIVED";
};

export type ClassRow = {
  id: string;
  name: string;
  courseName: string;
  teacherName: string;
  capacity: number | null;
  status: "ACTIVE" | "ARCHIVED";
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
}: {
  courses: CourseRow[];
  classes: ClassRow[];
  courseOptions: CourseOption[];
  teacherOptions: TeacherOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState<"course" | "class" | null>(null);
  const [archiving, setArchiving] = useState<{ kind: "course" | "class"; id: string; name: string } | null>(null);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

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

  return (
    <section className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">课程与班级</h1>
          <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">课程是机构自己定义的类型。班级挂在课程下，并指定一名主讲教师。</p>
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

      <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse text-left text-xs">
            <thead className="bg-[#fafbf9] text-[10px] tracking-wide text-[#84918e]">
              <tr>
                <th className="px-4 py-3 font-extrabold">课程</th>
                <th className="px-4 py-3 font-extrabold">类别</th>
                <th className="px-4 py-3 font-extrabold">说明</th>
                <th className="px-4 py-3 font-extrabold">状态</th>
                <th className="px-4 py-3 font-extrabold">操作</th>
              </tr>
            </thead>
            <tbody>
              {courses.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center leading-7 text-[var(--muted)]">
                    还没有课程。可以先创建一门课程，再创建班级。
                  </td>
                </tr>
              ) : (
                courses.map((course) => (
                  <tr key={course.id} className="border-t border-[#eef1ee]">
                    <td className="px-4 py-4 font-bold">{course.name}</td>
                    <td className="px-4 py-4 text-[var(--muted)]">{course.category ? categoryLabels[course.category] : "未分类"}</td>
                    <td className="px-4 py-4 text-[var(--muted)]">{course.description ?? "—"}</td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${course.status === "ACTIVE" ? "bg-[#edf5f1] text-[#34725d]" : "bg-[#fff2df] text-[#9a6729]"}`}>
                        {course.status === "ACTIVE" ? "启用中" : "已归档"}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      {course.status === "ACTIVE" ? (
                        <button type="button" className="font-bold text-[#9a6729]" onClick={() => setArchiving({ kind: "course", id: course.id, name: course.name })}>
                          归档
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">班级</h2>
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
              {classes.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center leading-7 text-[var(--muted)]">
                    还没有班级。创建时需要从已有课程和在职教师中选择。
                  </td>
                </tr>
              ) : (
                classes.map((item) => (
                  <tr key={item.id} className="border-t border-[#eef1ee]">
                    <td className="px-4 py-4 font-bold">{item.name}</td>
                    <td className="px-4 py-4">{item.courseName}</td>
                    <td className="px-4 py-4">{item.teacherName}</td>
                    <td className="px-4 py-4 text-[var(--muted)]">{item.capacity ?? "不限"}</td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${item.status === "ACTIVE" ? "bg-[#edf5f1] text-[#34725d]" : "bg-[#fff2df] text-[#9a6729]"}`}>
                        {item.status === "ACTIVE" ? "启用中" : "已归档"}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      {item.status === "ACTIVE" ? (
                        <button type="button" className="font-bold text-[#9a6729]" onClick={() => setArchiving({ kind: "class", id: item.id, name: item.name })}>
                          归档
                        </button>
                      ) : (
                        "—"
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

      {creating === "class" ? (
        <Modal title="创建班级" onClose={() => setCreating(null)}>
          <form onSubmit={saveClass} className="px-5 py-5">
            <div className="grid gap-3">
              <TextField label="班级名称" name="name" required placeholder="例如：初二数学 A 班" error={fieldErrors.name} />
              <label className="grid gap-1.5 text-xs font-bold">
                所属课程 *
                <select name="courseId" defaultValue="" required className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]">
                  <option value="">请选择课程</option>
                  {courseOptions.map((course) => (
                    <option key={course.id} value={course.id}>{course.name}</option>
                  ))}
                </select>
                <FieldError message={fieldErrors.courseId} />
              </label>
              <label className="grid gap-1.5 text-xs font-bold">
                主讲教师 *
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
