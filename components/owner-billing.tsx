"use client";

import { FormEvent, useState, useTransition } from "react";
import { createEnrollment } from "@/app/owner/billing/actions";
import { Modal } from "@/components/modal";

export type BillingStudent = {
  id: string;
  name: string;
  grade: string | null;
  remainingHours: number;
  courses: string;
  lastPaid: string;
  followUp: boolean;
  enrolled: boolean;
};

const fieldClass = "rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]";

export function OwnerBilling({
  students,
  courses,
  stats,
}: {
  students: BillingStudent[];
  courses: { id: string; name: string }[];
  stats: { enrollments: number; compare: string; income: string; renewing: number; review: number };
}) {
  const [open, setOpen] = useState(false);
  const [studentId, setStudentId] = useState("");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const followUps = students.filter((student) => student.followUp).length;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setMessage("");
    setFailed(false);
    startTransition(async () => {
      const result = await createEnrollment(formData);
      setFailed(!result.ok);
      setMessage(result.message || (result.ok ? "已保存。" : "保存失败。"));
      if (result.ok) setOpen(false);
    });
  }

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">报名与课时</h1>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-[var(--muted)]">先记录业务状态和课时变化，第一版不接在线支付与复杂财务核算。</p>
        </div>
        <button type="button" onClick={() => { setOpen(true); setStudentId(""); setMessage(""); }} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white">＋ 记录报名</button>
      </div>
      {message && !open ? <p className={`mt-4 rounded-xl px-4 py-3 text-xs leading-6 ${failed ? "bg-[#fff4ec] text-[#9a4b24]" : "bg-[#f0f6ee] text-[#4e6c5c]"}`}>{message}</p> : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card icon="♙" label="本月报名" value={String(stats.enrollments)} foot={stats.compare} />
        <Card icon="¥" label="本月实收记录" value={stats.income} foot="根据已保存的实收金额汇总" />
        <Card icon="◷" label="即将续费" value={String(stats.renewing)} foot="已报名且剩余课时少于 8 节" />
        <Card icon="!" label="课时待核对" value={String(stats.review)} foot="本月请假或缺勤，未扣课时" />
      </div>

      <section className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf0ee] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">学员课时</h2>
            <p className="mt-1 text-[11px] text-[var(--muted)]">剩余课时和最近一次缴费都来自报名记录</p>
          </div>
          <span className="rounded-full bg-[#fff2df] px-2 py-1 text-[10px] font-bold text-[#9a6729]">{followUps} 位待跟进</span>
        </div>
        {students.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm leading-7 text-[var(--muted)]">还没有在读学员。请先到学生管理里添加。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-xs">
              <thead className="bg-[#fafbf9] text-[10px] tracking-wide text-[#84918e]">
                <tr>
                  <th className="px-4 py-3 font-extrabold">学员</th>
                  <th className="px-4 py-3 font-extrabold">报名课程</th>
                  <th className="px-4 py-3 font-extrabold">剩余课时</th>
                  <th className="px-4 py-3 font-extrabold">最近缴费</th>
                  <th className="px-4 py-3 font-extrabold">续费状态</th>
                  <th className="px-4 py-3 font-extrabold">操作</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student.id} className="border-t border-[#eef1ee]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="grid h-8 w-8 place-items-center rounded-full bg-[#dcece5] text-xs font-extrabold text-[#215a52]">{student.name.slice(0, 1)}</span>
                        <span>
                          <strong className="block">{student.name}</strong>
                          <span className="text-[11px] text-[var(--muted)]">{student.grade ?? "未填写年级"}</span>
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">{student.courses}</td>
                    <td className="px-4 py-3"><strong>{student.remainingHours}</strong> 节</td>
                    <td className="px-4 py-3">{student.lastPaid}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${student.followUp ? "bg-[#fff2df] text-[#9a6729]" : "bg-[#edf5f1] text-[#34725d]"}`}>
                        {student.enrolled ? (student.followUp ? "需要跟进" : "课时充足") : "未报名"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => { setStudentId(student.id); setOpen(true); setMessage(""); }} className="font-bold text-[var(--teal)]">记录报名</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-[#eef1ee] px-5 py-3 text-[11px] leading-6 text-[var(--muted)]">到课或迟到会扣 1 课时，请假、缺勤和未标记不扣。同一节课重复保存不会重复扣减。</p>
      </section>

      {open ? (
        <Modal title="记录报名" onClose={() => setOpen(false)}>
          <form onSubmit={submit} className="px-5 py-5">
            <div className="grid gap-3">
              <label className="grid gap-1.5 text-xs font-bold">
                学员姓名 <span className="font-medium text-[#9a6729]">必填</span>
                <select name="studentId" required value={studentId} onChange={(event) => setStudentId(event.target.value)} className={fieldClass}>
                  <option value="">请选择学员</option>
                  {students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}
                </select>
              </label>
              <label className="grid gap-1.5 text-xs font-bold">
                报名课程 <span className="font-medium text-[#9a6729]">必填</span>
                <select name="courseId" required defaultValue="" className={fieldClass}>
                  <option value="">请选择课程</option>
                  {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
                </select>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5 text-xs font-bold">
                  应收金额
                  <input name="amountDue" type="number" min="0" step="0.01" defaultValue="0.00" required className={fieldClass} />
                </label>
                <label className="grid gap-1.5 text-xs font-bold">
                  实收金额
                  <input name="amount" type="number" min="0" step="0.01" defaultValue="0.00" required className={fieldClass} />
                </label>
              </div>
              <label className="grid gap-1.5 text-xs font-bold">
                购买课时 <span className="font-medium text-[#9a6729]">必填</span>
                <input name="hoursAdded" type="number" min="1" max="500" step="1" defaultValue="12" required className={fieldClass} />
              </label>
            </div>
            {courses.length === 0 ? <p className="mt-3 text-xs text-[#9a6729]">还没有在用的课程。请先到课程与班级里创建。</p> : null}
            {message ? <p className="mt-3 text-xs text-[#b94d4d]">{message}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold">取消</button>
              <button disabled={pending || courses.length === 0 || students.length === 0} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">{pending ? "正在保存…" : "保存"}</button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}

function Card({ icon, label, value, foot }: { icon: string; label: string; value: string; foot: string }) {
  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
      <div className="flex items-center justify-between text-xs text-[var(--muted)]">
        <span>{label}</span>
        <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-[var(--teal-2)]">{icon}</span>
      </div>
      <div className="mt-3 text-[29px] font-extrabold tracking-tight">{value}</div>
      <p className="mt-1 text-[11px] text-[var(--muted)]">{foot}</p>
    </article>
  );
}
