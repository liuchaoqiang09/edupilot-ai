"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";
import { TextField } from "@/components/form-fields";
import { Modal } from "@/components/modal";
import { createStudent, setStudentStatus, updateStudent, type FieldErrors } from "@/app/owner/students/actions";
import { linkParent, unlinkParent } from "@/app/owner/students/links";

export type StudentRow = {
  id: string;
  name: string;
  studentNo: string | null;
  grade: string | null;
  contactNote: string | null;
  status: "ACTIVE" | "INACTIVE";
};

export type ParentAccount = { id: string; name: string; email: string };
export type GuardianLink = { id: string; studentId: string; parentUserId: string; parentName: string; parentEmail: string };

export function StudentDirectory({
  students,
  query,
  parents,
  links,
}: {
  students: StudentRow[];
  query: string;
  parents: ParentAccount[];
  links: GuardianLink[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<StudentRow | null | "new">(null);
  const [viewing, setViewing] = useState<StudentRow | null>(null);
  const [confirming, setConfirming] = useState<StudentRow | null>(null);
  const [message, setMessage] = useState("");
  const [linkMessage, setLinkMessage] = useState("");
  const [parentId, setParentId] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setMessage("");
    setFieldErrors({});
    startTransition(async () => {
      const result = editing === "new" ? await createStudent(formData) : editing ? await updateStudent(editing.id, formData) : { ok: false };
      if (!result.ok) {
        setMessage(result.message ?? "");
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      setEditing(null);
      router.refresh();
    });
  }

  function changeStatus(student: StudentRow, status: "ACTIVE" | "INACTIVE") {
    setMessage("");
    startTransition(async () => {
      const result = await setStudentStatus(student.id, status);
      if (!result.ok) {
        setMessage(result.message ?? "操作失败。");
        return;
      }
      setConfirming(null);
      router.refresh();
    });
  }

  function bindGuardian(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!viewing || !parentId) {
      setLinkMessage("请选择家长账号。");
      return;
    }
    setLinkMessage("");
    startTransition(async () => {
      const result = await linkParent(viewing.id, parentId);
      if (!result.ok) {
        setLinkMessage(result.message ?? "绑定失败。");
        return;
      }
      setParentId("");
      router.refresh();
    });
  }

  function removeGuardian(linkId: string) {
    setLinkMessage("");
    startTransition(async () => {
      const result = await unlinkParent(linkId);
      if (!result.ok) {
        setLinkMessage(result.message ?? "解除失败。");
        return;
      }
      router.refresh();
    });
  }

  const guardians = viewing ? links.filter((link) => link.studentId === viewing.id) : [];
  const availableParents = parents.filter((parent) => !guardians.some((link) => link.parentUserId === parent.id));

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">学生管理</h1>
          <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">学生档案按当前机构保存。停用后仍可查询，不会删除历史记录。</p>
        </div>
        <button type="button" onClick={() => { setEditing("new"); setFieldErrors({}); setMessage(""); }} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white">
          ＋ 新增学生
        </button>
      </div>

      <form action="/owner/students" className="mt-6 flex flex-wrap gap-2">
        <input
          name="q"
          defaultValue={query}
          placeholder="搜索姓名或编号"
          className="w-full rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm outline-none focus:border-[var(--teal)] sm:w-auto sm:min-w-[220px] sm:flex-1"
        />
        <button className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold text-[#385058]">搜索</button>
        {query ? (
          <Link href="/owner/students" className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold text-[#385058]">
            重置
          </Link>
        ) : null}
      </form>
      {message ? <p className="mt-3 text-sm text-[#b94d4d]">{message}</p> : null}

      <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-xs">
            <thead className="bg-[#fafbf9] text-[10px] tracking-wide text-[#84918e]">
              <tr>
                <th className="px-4 py-3 font-extrabold">学生</th>
                <th className="px-4 py-3 font-extrabold">编号</th>
                <th className="px-4 py-3 font-extrabold">年级 / 年龄</th>
                <th className="px-4 py-3 font-extrabold">状态</th>
                <th className="px-4 py-3 font-extrabold">操作</th>
              </tr>
            </thead>
            <tbody>
              {students.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center leading-7 text-[var(--muted)]">
                    {query ? "没有找到符合条件的学生。" : "还没有学生。可以先新增一名学生。"}
                  </td>
                </tr>
              ) : (
                students.map((student) => (
                  <tr key={student.id} className="border-t border-[#eef1ee]">
                    <td className="px-4 py-4 font-bold">{student.name}</td>
                    <td className="px-4 py-4 text-[var(--muted)]">{student.studentNo ?? "—"}</td>
                    <td className="px-4 py-4">{student.grade ?? "—"}</td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${student.status === "ACTIVE" ? "bg-[#edf5f1] text-[#34725d]" : "bg-[#fff2df] text-[#9a6729]"}`}>
                        {student.status === "ACTIVE" ? "在读" : "已停用"}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <button type="button" className="mr-3 font-bold text-[var(--teal)]" onClick={() => { setViewing(student); setLinkMessage(""); setParentId(""); }}>查看</button>
                      <button type="button" className="mr-3 font-bold text-[var(--teal)]" onClick={() => { setEditing(student); setFieldErrors({}); setMessage(""); }}>编辑</button>
                      {student.status === "ACTIVE" ? (
                        <button type="button" className="font-bold text-[#9a6729]" onClick={() => setConfirming(student)}>停用</button>
                      ) : (
                        <button type="button" className="font-bold text-[var(--teal)]" disabled={pending} onClick={() => changeStatus(student, "ACTIVE")}>恢复在读</button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-[#eef1ee] px-4 py-3 text-[11px] text-[var(--muted)]">共 {students.length} 名学生 · 数据来自当前机构</div>
      </div>

      {editing ? (
        <Modal title={editing === "new" ? "新增学生" : "编辑学生"} onClose={() => setEditing(null)}>
          <form key={editing === "new" ? "new" : editing.id} onSubmit={save} className="px-5 py-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="学生姓名" name="name" required defaultValue={editing === "new" ? "" : editing.name} placeholder="请输入姓名" error={fieldErrors.name} />
              <TextField label="学生编号" name="studentNo" defaultValue={editing === "new" ? "" : editing.studentNo} placeholder="留空则自动生成" error={fieldErrors.studentNo} />
              <TextField label="年级 / 年龄" name="grade" defaultValue={editing === "new" ? "" : editing.grade} placeholder="例如：初二" error={fieldErrors.grade} />
              <TextField label="联系备注" name="contactNote" defaultValue={editing === "new" ? "" : editing.contactNote} placeholder="选填，仅机构内部可见" error={fieldErrors.contactNote} />
            </div>
            {message ? <p className="mt-3 text-xs text-[#b94d4d]">{message}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold">取消</button>
              <button disabled={pending} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">{pending ? "正在保存…" : "保存"}</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {viewing ? (
        <Modal title="学生档案" onClose={() => setViewing(null)}>
          <div className="space-y-4 px-5 py-5 text-sm">
            <div><div className="text-xs font-bold">姓名</div><p className="mt-1">{viewing.name}</p></div>
            <div><div className="text-xs font-bold">编号</div><p className="mt-1 text-[var(--muted)]">{viewing.studentNo ?? "—"}</p></div>
            <div><div className="text-xs font-bold">年级 / 年龄</div><p className="mt-1 text-[var(--muted)]">{viewing.grade ?? "未填写"}</p></div>
            <div><div className="text-xs font-bold">联系备注</div><p className="mt-1 leading-6 text-[var(--muted)]">{viewing.contactNote ?? "未填写"}</p></div>
            <div>
              <div className="text-xs font-bold">已绑定家长</div>
              {guardians.length === 0 ? (
                <p className="mt-2 text-[var(--muted)]">还没有绑定家长。绑定后，该家长登录只能看到这名学生。</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {guardians.map((guardian) => (
                    <li key={guardian.id} className="flex items-center justify-between gap-3 rounded-xl bg-[#f7faf8] px-3 py-2">
                      <span>
                        <span className="font-bold">{guardian.parentName}</span>
                        <span className="ml-2 text-[var(--muted)]">{guardian.parentEmail}</span>
                      </span>
                      <button type="button" disabled={pending} onClick={() => removeGuardian(guardian.id)} className="font-bold text-[#9a6729]">解除</button>
                    </li>
                  ))}
                </ul>
              )}
              <form onSubmit={bindGuardian} className="mt-3 grid gap-2">
                <label className="grid gap-1.5 text-xs font-bold">
                  绑定家长账号
                  <select value={parentId} onChange={(event) => setParentId(event.target.value)} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]">
                    <option value="">请选择本机构家长</option>
                    {availableParents.map((parent) => (
                      <option key={parent.id} value={parent.id}>{parent.name} · {parent.email}</option>
                    ))}
                  </select>
                </label>
                {availableParents.length === 0 ? <p className="text-xs text-[var(--muted)]">没有可绑定的家长账号。</p> : null}
                {linkMessage ? <p className="text-xs text-[#b94d4d]">{linkMessage}</p> : null}
                <div>
                  <button disabled={pending || availableParents.length === 0} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">
                    {pending ? "正在绑定…" : "绑定"}
                  </button>
                </div>
              </form>
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={() => setViewing(null)} className="rounded-[10px] border border-[var(--line)] px-3.5 py-2.5 text-xs font-bold">关闭</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {confirming ? (
        <Modal title="停用学生" onClose={() => setConfirming(null)}>
          <div className="px-5 py-5 text-sm leading-7 text-[var(--muted)]">
            停用后不会删除「{confirming.name}」的档案。以后产生的课次和报告也会保留。
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirming(null)} className="rounded-[10px] border border-[var(--line)] px-3.5 py-2.5 text-xs font-bold">取消</button>
              <button type="button" disabled={pending} onClick={() => changeStatus(confirming, "INACTIVE")} className="rounded-[10px] bg-[#c27b35] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">
                {pending ? "正在停用…" : "确认停用"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
