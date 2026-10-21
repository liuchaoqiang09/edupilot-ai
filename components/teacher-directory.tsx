"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";
import { FieldError, TextField } from "@/components/form-fields";
import { Modal } from "@/components/modal";
import { createTeacher, setTeacherStatus, updateTeacher, type FieldErrors } from "@/app/owner/teachers/actions";

export type AccountOption = { id: string; name: string; email: string };

export type TeacherRow = {
  id: string;
  name: string;
  contact: string | null;
  status: "ACTIVE" | "INACTIVE";
  userId: string | null;
  accountName: string | null;
};

export function TeacherDirectory({
  teachers,
  accounts,
  links,
  query,
}: {
  teachers: TeacherRow[];
  accounts: AccountOption[];
  links: { teacherId: string; userId: string }[];
  query: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<TeacherRow | "new" | null>(null);
  const [viewing, setViewing] = useState<TeacherRow | null>(null);
  const [confirming, setConfirming] = useState<TeacherRow | null>(null);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setMessage("");
    setFieldErrors({});
    startTransition(async () => {
      const result = editing === "new" ? await createTeacher(formData) : editing ? await updateTeacher(editing.id, formData) : { ok: false };
      if (!result.ok) {
        setMessage(result.message ?? "");
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      setEditing(null);
      router.refresh();
    });
  }

  function changeStatus(teacher: TeacherRow, status: "ACTIVE" | "INACTIVE") {
    setMessage("");
    startTransition(async () => {
      const result = await setTeacherStatus(teacher.id, status);
      if (!result.ok) {
        setMessage(result.message ?? "操作失败。");
        return;
      }
      setConfirming(null);
      router.refresh();
    });
  }

  const current = editing && editing !== "new" ? editing : null;
  const options = accounts.filter(
    (account) => account.id === current?.userId || !links.some((link) => link.userId === account.id && link.teacherId !== current?.id),
  );

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">教师管理</h1>
          <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">可以先建立教师档案，之后再关联登录账号。停用不会删除档案。</p>
        </div>
        <button type="button" onClick={() => { setEditing("new"); setFieldErrors({}); setMessage(""); }} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white">
          ＋ 新增教师
        </button>
      </div>

      <form action="/owner/teachers" className="mt-6 flex flex-wrap gap-2">
        <input name="q" defaultValue={query} placeholder="搜索教师姓名" className="w-full rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm outline-none focus:border-[var(--teal)] sm:w-auto sm:min-w-[220px] sm:flex-1" />
        <button className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold text-[#385058]">搜索</button>
        {query ? <Link href="/owner/teachers" className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold text-[#385058]">重置</Link> : null}
      </form>
      {message ? <p className="mt-3 text-sm text-[#b94d4d]">{message}</p> : null}

      <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-xs">
            <thead className="bg-[#fafbf9] text-[10px] tracking-wide text-[#84918e]">
              <tr>
                <th className="px-4 py-3 font-extrabold">教师</th>
                <th className="px-4 py-3 font-extrabold">联系方式</th>
                <th className="px-4 py-3 font-extrabold">登录账号</th>
                <th className="px-4 py-3 font-extrabold">状态</th>
                <th className="px-4 py-3 font-extrabold">操作</th>
              </tr>
            </thead>
            <tbody>
              {teachers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center leading-7 text-[var(--muted)]">
                    {query ? "没有找到符合条件的教师。" : "还没有教师。可以先新增一位教师。"}
                  </td>
                </tr>
              ) : (
                teachers.map((teacher) => (
                  <tr key={teacher.id} className="border-t border-[#eef1ee]">
                    <td className="px-4 py-4 font-bold">{teacher.name}</td>
                    <td className="px-4 py-4 text-[var(--muted)]">{teacher.contact ?? "—"}</td>
                    <td className="px-4 py-4">{teacher.accountName ?? "未关联"}</td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${teacher.status === "ACTIVE" ? "bg-[#edf5f1] text-[#34725d]" : "bg-[#fff2df] text-[#9a6729]"}`}>
                        {teacher.status === "ACTIVE" ? "在职" : "已停用"}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <button type="button" className="mr-3 font-bold text-[var(--teal)]" onClick={() => setViewing(teacher)}>查看</button>
                      <button type="button" className="mr-3 font-bold text-[var(--teal)]" onClick={() => { setEditing(teacher); setFieldErrors({}); setMessage(""); }}>编辑</button>
                      {teacher.status === "ACTIVE" ? (
                        <button type="button" className="font-bold text-[#9a6729]" onClick={() => setConfirming(teacher)}>停用</button>
                      ) : (
                        <button type="button" className="font-bold text-[var(--teal)]" disabled={pending} onClick={() => changeStatus(teacher, "ACTIVE")}>恢复在职</button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-[#eef1ee] px-4 py-3 text-[11px] text-[var(--muted)]">共 {teachers.length} 位教师 · 数据来自当前机构</div>
      </div>

      {editing ? (
        <Modal title={editing === "new" ? "新增教师" : "编辑教师"} onClose={() => setEditing(null)}>
          <form key={editing === "new" ? "new" : editing.id} onSubmit={save} className="px-5 py-5">
            <div className="grid gap-3">
              <TextField label="教师姓名" name="name" required defaultValue={editing === "new" ? "" : editing.name} placeholder="请输入姓名" error={fieldErrors.name} />
              <TextField label="联系方式" name="contact" defaultValue={editing === "new" ? "" : editing.contact} placeholder="选填，电话或其他联系方式" error={fieldErrors.contact} />
              <label className="grid gap-1.5 text-xs font-bold">
                登录账号
                <select name="userId" defaultValue={editing === "new" ? "" : editing.userId ?? ""} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]">
                  <option value="">暂不关联</option>
                  {options.map((account) => (
                    <option key={account.id} value={account.id}>{account.name} · {account.email}</option>
                  ))}
                </select>
                <FieldError message={fieldErrors.userId} />
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

      {viewing ? (
        <Modal title="教师档案" onClose={() => setViewing(null)}>
          <div className="space-y-4 px-5 py-5 text-sm">
            <div><div className="text-xs font-bold">姓名</div><p className="mt-1">{viewing.name}</p></div>
            <div><div className="text-xs font-bold">联系方式</div><p className="mt-1 text-[var(--muted)]">{viewing.contact ?? "未填写"}</p></div>
            <div><div className="text-xs font-bold">登录账号</div><p className="mt-1 text-[var(--muted)]">{viewing.accountName ?? "未关联，可以稍后邀请"}</p></div>
            <p className="rounded-xl bg-[#f0f6ee] p-3 text-xs leading-6 text-[#4e6c5c]">课表、负责班级和教学记录会在后续阶段显示。当前没有这些关联记录。</p>
            <div className="flex justify-end">
              <button type="button" onClick={() => setViewing(null)} className="rounded-[10px] border border-[var(--line)] px-3.5 py-2.5 text-xs font-bold">关闭</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {confirming ? (
        <Modal title="停用教师" onClose={() => setConfirming(null)}>
          <div className="px-5 py-5 text-sm leading-7 text-[var(--muted)]">
            停用后不会删除「{confirming.name}」的档案。目前还没有未来课次；之后如果已有排课，停用前需要先调整那些课次的授课教师。
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
