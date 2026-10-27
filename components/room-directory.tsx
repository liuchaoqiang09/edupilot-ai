"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState, useTransition } from "react";
import { createClassroom, updateClassroom, type RoomErrors } from "@/app/owner/rooms/actions";
import { TextField } from "@/components/form-fields";
import { Modal } from "@/components/modal";

export type RoomRow = {
  id: string;
  name: string;
  capacity: number;
  available: boolean;
  weekCount: number;
  looseCount: number;
};

export function RoomDirectory({ rooms, weekStart, today, openFormKey = "" }: { rooms: RoomRow[]; weekStart: string; today: string; openFormKey?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (!openFormKey) return;
    setCreating(true);
    setConfirmDisable(false);
    setFieldErrors({});
    setMessage("");
  }, [openFormKey]);
  const [editing, setEditing] = useState<RoomRow | null>(null);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<RoomErrors>({});

  function save(event: FormEvent<HTMLFormElement>, classroomId?: string) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setMessage("");
    setFieldErrors({});
    startTransition(async () => {
      const result = classroomId ? await updateClassroom(classroomId, formData) : await createClassroom(formData);
      if (result.needsDisableConfirm) {
        setConfirmDisable(true);
        setMessage(result.message ?? "");
        return;
      }
      if (!result.ok) {
        setMessage(result.message ?? "");
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      setNotice(result.message ?? "");
      setCreating(false);
      setEditing(null);
      setConfirmDisable(false);
      router.refresh();
    });
  }

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">教室管理</h1>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-[var(--muted)]">新排课从这里选择教室。本周课次含已挂上的课，以及地点文字相同、还没挂教室的旧课。停用后新排课不能再选，已经排好的课保留。</p>
        </div>
        <button type="button" onClick={() => { setCreating(true); setConfirmDisable(false); setFieldErrors({}); setMessage(""); }} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white">＋ 添加教室</button>
      </div>
      {notice ? <p className="mt-4 rounded-xl bg-[#f0f6ee] px-4 py-3 text-xs leading-6 text-[#4e6c5c]">{notice}</p> : null}
      <div className="mt-6 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="bg-[#fafbf9] text-[10px] tracking-wide text-[#84918e]">
            <tr>
              <th className="px-4 py-3 font-extrabold">名称</th>
              <th className="px-4 py-3 font-extrabold">容量</th>
              <th className="px-4 py-3 font-extrabold">状态</th>
              <th className="px-4 py-3 font-extrabold">本周课次</th>
              <th className="px-4 py-3 font-extrabold">操作</th>
            </tr>
          </thead>
          <tbody>
            {rooms.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-sm text-[var(--muted)]">还没有教室。添加后就可以在排课时选择。</td></tr>
            ) : rooms.map((room) => (
              <tr key={room.id} className="border-t border-[#eef1ee]">
                <td className="px-4 py-4 font-bold">{room.name}</td>
                <td className="px-4 py-4">{room.capacity} 人</td>
                <td className="px-4 py-4">
                  <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${room.available ? "bg-[#edf5f1] text-[#34725d]" : "bg-[#eef1ee] text-[#74838b]"}`}>{room.available ? "可用" : "停用"}</span>
                  {room.looseCount > 0 ? <span className="mt-1 block text-[11px] text-[var(--muted)]">还可挂上 {room.looseCount} 节旧课</span> : null}
                </td>
                <td className="px-4 py-4">
                  <Link href={`/owner/schedule?view=week&week=${weekStart}&date=${today}&room=${room.id}`} className="font-bold text-[var(--teal)]">本周 {room.weekCount} 节</Link>
                </td>
                <td className="px-4 py-4">
                  <button type="button" className="font-bold text-[var(--teal)]" onClick={() => { setEditing(room); setConfirmDisable(false); setFieldErrors({}); setMessage(""); }}>编辑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {creating ? (
        <Modal title="添加教室" onClose={() => setCreating(false)}>
          <RoomForm pending={pending} message={message} fieldErrors={fieldErrors} confirmDisable={confirmDisable} onSubmit={(event) => save(event)} />
        </Modal>
      ) : null}
      {editing ? (
        <Modal title="编辑教室" onClose={() => setEditing(null)}>
          <RoomForm pending={pending} message={message} fieldErrors={fieldErrors} room={editing} confirmDisable={confirmDisable} onSubmit={(event) => save(event, editing.id)} />
        </Modal>
      ) : null}
    </section>
  );
}

function RoomForm({
  room,
  pending,
  message,
  fieldErrors,
  confirmDisable,
  onSubmit,
}: {
  room?: RoomRow;
  pending: boolean;
  message: string;
  fieldErrors: RoomErrors;
  confirmDisable: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="grid gap-3 px-5 py-5">
      <TextField label="名称" name="name" required defaultValue={room?.name ?? ""} placeholder="例如 A201" error={fieldErrors.name} />
      <TextField label="容量" name="capacity" required defaultValue={room ? String(room.capacity) : ""} placeholder="例如 12" error={fieldErrors.capacity} />
      <label className="flex items-center gap-2 text-xs font-bold">
        <input type="checkbox" name="available" value="1" defaultChecked={room ? room.available : true} className="accent-[var(--teal)]" />
        可用。取消勾选后，新排课不能再选这间教室。
      </label>
      <label className="flex items-start gap-2 text-xs leading-6">
        <input type="checkbox" name="linkMatches" value="1" className="mt-1 accent-[var(--teal)]" />
        <span>把地点文字与这个名称相同、还没挂教室的旧课次挂到这间教室。不勾选则不改旧课。</span>
      </label>
      {confirmDisable ? <input type="hidden" name="confirmDisable" value="1" /> : null}
      {message ? <p className="whitespace-pre-line text-xs leading-6 text-[#9a6729]">{message}</p> : null}
      <div className="flex justify-end">
        <button disabled={pending} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">{pending ? "正在保存…" : confirmDisable ? "确认停用" : "保存"}</button>
      </div>
    </form>
  );
}
