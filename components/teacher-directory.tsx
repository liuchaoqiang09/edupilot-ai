"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";
import { FieldError, TextField } from "@/components/form-fields";
import { TeacherInviteButton } from "@/components/invite-button";
import { Modal } from "@/components/modal";
import { SortHeader } from "@/components/sort-header";
import type { SortOrder } from "@/lib/table-sort";
import { createTeacher, revokeTeacherLogin, setTeacherStatus, updateTeacher, type FieldErrors } from "@/app/owner/teachers/actions";

export type TeacherRow = {
  id: string;
  name: string;
  contact: string | null;
  status: "ACTIVE" | "INACTIVE";
  linked: boolean;
  accountEmail: string | null;
};

export function TeacherDirectory({
  teachers,
  query,
  sortBy,
  order,
}: {
  teachers: TeacherRow[];
  query: string;
  sortBy: "name" | "contact" | null;
  order: SortOrder | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<TeacherRow | "new" | null>(null);
  const [viewing, setViewing] = useState<TeacherRow | null>(null);
  const [confirming, setConfirming] = useState<TeacherRow | null>(null);
  const [revoking, setRevoking] = useState<TeacherRow | null>(null);
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

  function revokeLogin(teacher: TeacherRow) {
    setMessage("");
    startTransition(async () => {
      const result = await revokeTeacherLogin(teacher.id);
      if (!result.ok) {
        setMessage(result.message ?? "收回失败。");
        return;
      }
      setRevoking(null);
      setMessage("");
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

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">教师管理</h1>
          <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">新老师默认暂不关联。把邀请码发给老师后，对方注册成功会自动关联。密码只有老师自己知道，负责人不能查看。</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <TeacherInviteButton />
          <button type="button" onClick={() => { setEditing("new"); setFieldErrors({}); setMessage(""); }} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white">
            ＋ 新增教师
          </button>
        </div>
      </div>

      <form action="/owner/teachers" className="mt-6 flex flex-wrap gap-2">
        {sortBy && order ? (
          <>
            <input type="hidden" name="sortBy" value={sortBy} />
            <input type="hidden" name="order" value={order} />
          </>
        ) : null}
        <input name="q" defaultValue={query} placeholder="搜索教师姓名" className="w-full rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm outline-none focus:border-[var(--teal)] sm:w-auto sm:min-w-[220px] sm:flex-1" />
        <button className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold text-[#385058]">搜索</button>
        {query ? <Link href={sortBy && order ? `/owner/teachers?sortBy=${sortBy}&order=${order}` : "/owner/teachers"} className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold text-[#385058]">重置</Link> : null}
      </form>
      {message ? <p className="mt-3 text-sm text-[#b94d4d]">{message}</p> : null}

      <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-xs">
            <thead className="bg-[#fafbf9] text-[10px] tracking-wide text-[#84918e]">
              <tr>
                <SortHeader label="教师" field="name" sortBy={sortBy} order={order} pathname="/owner/teachers" query={query} />
                <SortHeader label="联系方式" field="contact" sortBy={sortBy} order={order} pathname="/owner/teachers" query={query} />
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
                    <td className="px-4 py-4">{teacher.linked && teacher.accountEmail ? teacher.accountEmail : "暂不关联"}</td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${teacher.status === "ACTIVE" ? "bg-[#edf5f1] text-[#34725d]" : "bg-[#fff2df] text-[#9a6729]"}`}>
                        {teacher.status === "ACTIVE" ? "在职" : "已停用"}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <button type="button" className="mr-3 font-bold text-[var(--teal)]" onClick={() => setViewing(teacher)}>查看</button>
                      <button type="button" className="mr-3 font-bold text-[var(--teal)]" onClick={() => { setEditing(teacher); setFieldErrors({}); setMessage(""); }}>编辑</button>
                      {teacher.linked ? (
                        <button type="button" className="mr-3 font-bold text-[#9a6729]" onClick={() => setRevoking(teacher)}>收回账号</button>
                      ) : null}
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
                <select name="link" defaultValue={editing !== "new" && editing.linked ? "1" : "0"} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]">
                  <option value="0">暂不关联</option>
                  <option value="1">{editing !== "new" && editing.accountEmail ? `关联账号 · ${editing.accountEmail}` : "关联账号"}</option>
                </select>
                <FieldError message={fieldErrors.link} />
                <span className="font-medium leading-5 text-[var(--muted)]">只能二选一。取消关联后可以再选回来，密码不会变，负责人也看不到密码。</span>
              </label>
              {editing !== "new" && !editing.accountEmail ? <TeacherInviteButton teacherId={editing.id} /> : null}
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
            <div><div className="text-xs font-bold">登录账号</div><p className="mt-1 text-[var(--muted)]">{viewing.linked && viewing.accountEmail ? `已关联 ${viewing.accountEmail}` : "暂不关联"}</p></div>
            <p className="rounded-xl bg-[#f0f6ee] p-3 text-xs leading-6 text-[#4e6c5c]">关联后只能看到自己的课表、考勤和教学记录。密码只有老师自己知道。</p>
            <div className="flex justify-end">
              <button type="button" onClick={() => setViewing(null)} className="rounded-[10px] border border-[var(--line)] px-3.5 py-2.5 text-xs font-bold">关闭</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {revoking ? (
        <Modal title="收回账号" onClose={() => setRevoking(null)}>
          <div className="px-5 py-5 text-sm leading-7 text-[var(--muted)]">
            收回后，「{revoking.name}」暂时不能进入自己的课表。密码保持不变，之后可以再选择「关联账号」。
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setRevoking(null)} className="rounded-[10px] border border-[var(--line)] px-3.5 py-2.5 text-xs font-bold">取消</button>
              <button type="button" disabled={pending} onClick={() => revokeLogin(revoking)} className="rounded-[10px] bg-[#c27b35] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">
                {pending ? "正在收回…" : "确认收回"}
              </button>
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
