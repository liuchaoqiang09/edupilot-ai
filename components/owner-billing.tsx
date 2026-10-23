"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";
import { createEnrollment } from "@/app/owner/billing/actions";
import { deactivateStudent } from "@/app/owner/students/actions";
import { DateField, isCalendarDate } from "@/components/date-field";
import { Modal } from "@/components/modal";
import { SortHeader } from "@/components/sort-header";
import { StudentCombobox, type DirectoryStudent } from "@/components/student-combobox";
import type { SortOrder } from "@/lib/table-sort";
import { parseAge, studentFacts, unenrolledBadgeClass } from "@/lib/student-profile";

export type BillingStudent = {
  rowKey: string;
  id: string;
  name: string;
  grade: string | null;
  age: number | null;
  courseName: string;
  usage: string;
  usageStatus: string;
  lastPaid: string;
  followUp: boolean;
  enrolled: boolean;
  canDeactivate: boolean;
  courseId?: string;
};

const fieldClass = "rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]";

type EnrollmentDraft = {
  key: string;
  courseId: string;
  classGroupId: string;
  amountDue: string;
  amount: string;
  hoursAdded: string;
  startDate: string;
  endDate: string;
};

function blankLine(courseId = ""): EnrollmentDraft {
  return {
    key: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    courseId,
    classGroupId: "",
    amountDue: "0.00",
    amount: "0.00",
    hoursAdded: "12",
    startDate: "",
    endDate: "",
  };
}

export function OwnerBilling({
  students,
  directory,
  courses,
  stats,
  renewalOnly = false,
  sortBy,
  order,
}: {
  students: BillingStudent[];
  directory: DirectoryStudent[];
  courses: { id: string; name: string; billingType: "PER_LESSON" | "PER_PERIOD"; classGroups: { id: string; name: string }[] }[];
  stats: { enrollments: number; compare: string; income: string; renewing: number; review: number };
  renewalOnly?: boolean;
  sortBy: "name" | "course" | null;
  order: SortOrder | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [retiring, setRetiring] = useState<BillingStudent | null>(null);
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [studentId, setStudentId] = useState("");
  const [studentName, setStudentName] = useState("");
  const [guardianName, setGuardianName] = useState("");
  const [grade, setGrade] = useState("");
  const [age, setAge] = useState("");
  const [lines, setLines] = useState<EnrollmentDraft[]>([blankLine()]);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const followUps = stats.renewing;

  function openEnrollment(nextStudentId = "", courseId = "") {
    setMode(nextStudentId ? "existing" : "new");
    setStudentId(nextStudentId);
    setStudentName("");
    setGuardianName(directory.find((student) => student.id === nextStudentId)?.guardianName ?? "");
    setGrade("");
    setAge("");
    setLines([blankLine(courseId)]);
    setMessage("");
    setFailed(false);
    setOpen(true);
  }

  function updateLine(key: string, patch: Partial<EnrollmentDraft>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "new" && studentName.trim().length === 0) {
      setFailed(true);
      setMessage("请填写学生姓名。");
      return;
    }
    const parsedAge = parseAge(age);
    if (mode === "new" && parsedAge.error) {
      setFailed(true);
      setMessage(parsedAge.error);
      return;
    }
    if (mode === "existing" && !studentId) {
      setFailed(true);
      setMessage("请选择学员。");
      return;
    }
    if (guardianName.trim().length === 0) {
      setFailed(true);
      setMessage("请填写家长姓名。");
      return;
    }
    if (guardianName.trim().length > 40) {
      setFailed(true);
      setMessage("家长姓名不能超过 40 个字。");
      return;
    }
    for (const line of lines) {
      const course = courses.find((item) => item.id === line.courseId);
      if (!course) {
        setFailed(true);
        setMessage("请选择报名课程。");
        return;
      }
      const classBelongs = course.classGroups.some((item) => item.id === line.classGroupId);
      if (!classBelongs) {
        setFailed(true);
        setMessage("请选择报名班级");
        return;
      }
      if (course.billingType === "PER_PERIOD" && (!isCalendarDate(line.startDate) || !isCalendarDate(line.endDate))) {
        setFailed(true);
        setMessage("请填写有效期开始时间和有效期结束时间。");
        return;
      }
    }
    const formData = new FormData();
    formData.set("mode", mode);
    formData.set("studentId", studentId);
    formData.set("studentName", studentName.trim());
    formData.set("guardianName", guardianName.trim());
    formData.set("grade", grade.trim());
    formData.set("age", age.trim());
    formData.set("count", String(lines.length));
    lines.forEach((line, index) => {
      formData.set(`courseId:${index}`, line.courseId);
      formData.set(`classGroupId:${index}`, line.classGroupId);
      formData.set(`amountDue:${index}`, line.amountDue);
      formData.set(`amount:${index}`, line.amount);
      formData.set(`hoursAdded:${index}`, line.hoursAdded);
      formData.set(`startDate:${index}`, line.startDate);
      formData.set(`endDate:${index}`, line.endDate);
    });
    setMessage("");
    setFailed(false);
    startTransition(async () => {
      const result = await createEnrollment(formData);
      setFailed(!result.ok);
      setMessage(result.message || (result.ok ? "已保存。" : "保存失败。"));
      if (result.ok) {
        setOpen(false);
        router.refresh();
      }
    });
  }

  function retire(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!retiring?.courseId) return;
    setMessage("");
    setFailed(false);
    startTransition(async () => {
      const result = await deactivateStudent(retiring.id, retiring.courseId!, reason);
      setFailed(!result.ok);
      setMessage(result.message || (result.ok ? "已停用。" : "停用失败。"));
      if (result.ok) {
        setRetiring(null);
        setReason("");
        router.refresh();
      }
    });
  }

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">报名与课时</h1>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-[var(--muted)]">按课时的课程记录剩余节数。按周期的课程记录有效期，出勤不扣课时。</p>
        </div>
        <button type="button" onClick={() => openEnrollment()} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white">＋ 记录报名</button>
      </div>
      {message && !open ? <p className={`mt-4 rounded-xl px-4 py-3 text-xs leading-6 ${failed ? "bg-[#fff4ec] text-[#9a4b24]" : "bg-[#f0f6ee] text-[#4e6c5c]"}`}>{message}</p> : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card icon="♙" label="本月报名" value={String(stats.enrollments)} foot={stats.compare} />
        <Card icon="¥" label="本月实收记录" value={stats.income} foot="根据已保存的实收金额汇总" />
        <Card icon="◷" label="即将续费" value={String(stats.renewing)} foot="课时不足 8 节，或周期课程已过期" />
        <Card icon="!" label="课时待核对" value={String(stats.review)} foot="本月请假，未扣课时" />
      </div>

      <section className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf0ee] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">学员课时</h2>
            <p className="mt-1 text-[11px] text-[var(--muted)]">{renewalOnly ? "当前正在筛选：待续费。只显示课时不足 8 节，或周期课程已过期、未填写有效期的报名。" : "按课时显示剩余节数，按周期显示有效期"}</p>
            {renewalOnly ? <Link href={sortBy && order ? `/owner/billing?sortBy=${sortBy}&order=${order}` : "/owner/billing"} className="mt-2 inline-block text-xs font-bold text-[var(--teal)]">重置</Link> : null}
          </div>
          <span className="rounded-full bg-[#fff2df] px-2 py-1 text-[10px] font-bold text-[#9a6729]">{followUps} 位待续费</span>
        </div>
        {students.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm leading-7 text-[var(--muted)]">{renewalOnly ? "没有待续费的学员。" : "还没有在读学员。请先到学生管理里添加。"}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-xs">
              <thead className="bg-[#fafbf9] text-[10px] tracking-wide text-[#84918e]">
                <tr>
                  <SortHeader label="学员" field="name" sortBy={sortBy} order={order} pathname="/owner/billing" extra={renewalOnly ? { status: "待续费" } : undefined} />
                  <SortHeader label="报名课程" field="course" sortBy={sortBy} order={order} pathname="/owner/billing" extra={renewalOnly ? { status: "待续费" } : undefined} />
                  <th className="px-4 py-3 font-extrabold">课时 / 有效期</th>
                  <th className="px-4 py-3 font-extrabold">最近缴费</th>
                  <th className="px-4 py-3 font-extrabold">状态</th>
                  <th className="px-4 py-3 font-extrabold">操作</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student.rowKey} className="border-t border-[#eef1ee]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="grid h-8 w-8 place-items-center rounded-full bg-[#dcece5] text-xs font-extrabold text-[#215a52]">{student.name.slice(0, 1)}</span>
                        <span>
                          <strong className="block">{student.name}</strong>
                          <span className="text-[11px] text-[var(--muted)]">{studentFacts(student.grade, student.age)}</span>
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">{student.courseName}</td>
                    <td className="px-4 py-3">{student.usage}</td>
                    <td className="px-4 py-3">{student.lastPaid}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${student.usageStatus === "未报名" ? unenrolledBadgeClass : student.followUp ? "bg-[#fff2df] text-[#9a6729]" : "bg-[#edf5f1] text-[#34725d]"}`}>
                        {student.usageStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => openEnrollment(student.id, student.courseId ?? "")} className="font-bold text-[var(--teal)]">记录报名</button>
                      {student.canDeactivate && student.courseId ? (
                        <button type="button" onClick={() => { setRetiring(student); setReason(""); setMessage(""); setFailed(false); }} className="ml-3 font-bold text-[#74838b]">停用学生</button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-[#eef1ee] px-5 py-3 text-[11px] leading-6 text-[var(--muted)]">按课时课程：出勤、迟到或缺勤扣这节课所属课程 1 课时。按周期课程不扣课时。请假和未标记会退回此前实际扣掉的那 1 课时。</p>
      </section>

      {retiring ? (
        <Modal title="停用学生" onClose={() => setRetiring(null)}>
          <form onSubmit={retire} className="px-5 py-5">
            <p className="text-sm leading-7 text-[var(--muted)]">停用后，「{retiring.name}」在学生管理中会变为已停用，也不能再排入新的课次。已有课次和报告会保留。</p>
            <label className="mt-4 grid gap-1.5 text-xs font-bold">
              停用原因 <span className="font-medium text-[#9a6729]">必填</span>
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={80} rows={3} placeholder="请填写停用原因" className={fieldClass} />
            </label>
            {message && !open ? <p className="mt-3 text-xs text-[#b94d4d]">{message}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setRetiring(null)} className="rounded-[10px] border border-[var(--line)] px-3.5 py-2.5 text-xs font-bold">取消</button>
              <button disabled={pending || reason.trim().length === 0} className="rounded-[10px] bg-[#74838b] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">{pending ? "正在停用…" : "确认停用"}</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {open ? (
        <Modal title="记录报名" onClose={() => { setOpen(false); setMessage(""); setFailed(false); }}>
          <form onSubmit={submit} className="px-5 py-5">
            <div className="grid gap-3">
              <div className="flex rounded-[10px] border border-[var(--line)] bg-white p-1">
                <button type="button" onClick={() => { setMode("new"); setGuardianName(""); }} className={`flex-1 rounded-lg px-3 py-2 text-xs font-bold ${mode === "new" ? "bg-[var(--teal)] text-white" : "text-[#385058]"}`}>新生报名</button>
                <button type="button" onClick={() => { setMode("existing"); setGuardianName(directory.find((student) => student.id === studentId)?.guardianName ?? ""); }} className={`flex-1 rounded-lg px-3 py-2 text-xs font-bold ${mode === "existing" ? "bg-[var(--teal)] text-white" : "text-[#385058]"}`}>老生续费/加报</button>
              </div>
              {mode === "new" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1.5 text-xs font-bold">
                    学生姓名 <span className="font-medium text-[#9a6729]">必填</span>
                    <input value={studentName} onChange={(event) => setStudentName(event.target.value)} placeholder="请输入姓名" className={fieldClass} />
                  </label>
                  <label className="grid gap-1.5 text-xs font-bold">
                    年级
                    <input value={grade} onChange={(event) => setGrade(event.target.value)} placeholder="例如：初二" className={fieldClass} />
                  </label>
                  <label className="grid gap-1.5 text-xs font-bold">
                    年龄
                    <input value={age} onChange={(event) => setAge(event.target.value)} inputMode="numeric" placeholder="例如：12" className={fieldClass} />
                  </label>
                </div>
              ) : (
                <label className="grid gap-1.5 text-xs font-bold">
                  学员姓名 <span className="font-medium text-[#9a6729]">必填</span>
                  <StudentCombobox students={directory} value={studentId} onChange={(id) => { setStudentId(id); setGuardianName(directory.find((student) => student.id === id)?.guardianName ?? ""); }} />
                </label>
              )}
              <label className="grid gap-1.5 text-xs font-bold">
                家长姓名 <span className="font-medium text-[#9a6729]">必填</span>
                <input value={guardianName} onChange={(event) => setGuardianName(event.target.value)} readOnly={mode === "existing" && Boolean(directory.find((student) => student.id === studentId)?.guardianName)} placeholder="请输入家长姓名" className={fieldClass} />
                {mode === "existing" && directory.find((student) => student.id === studentId)?.guardianName ? <span className="font-medium text-[var(--muted)]">这位学员已经有家长姓名。要修改，请到学生管理里编辑。</span> : null}
              </label>
              {lines.map((line, index) => {
                const course = courses.find((item) => item.id === line.courseId);
                const byPeriod = course?.billingType === "PER_PERIOD";
                return (
                  <div key={line.key} className="grid gap-3 rounded-xl border border-[var(--line)] bg-[#f7faf8] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-[#146b62]">第 {index + 1} 门</span>
                      {lines.length > 1 ? (
                        <button type="button" onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))} className="text-xs font-bold text-[#9a6729]">移除</button>
                      ) : null}
                    </div>
                    <label className="grid gap-1.5 text-xs font-bold">
                      报名课程 <span className="font-medium text-[#9a6729]">必填</span>
                      <select value={line.courseId} onChange={(event) => updateLine(line.key, { courseId: event.target.value, classGroupId: "" })} className={fieldClass}>
                        <option value="">请选择课程</option>
                        {courses.map((item) => <option key={item.id} value={item.id}>{item.name}{item.billingType === "PER_PERIOD" ? " · 按周期" : " · 按课时"}</option>)}
                      </select>
                    </label>
                    {course ? (
                      <label className="grid gap-1.5 text-xs font-bold">
                        报名班级 <span className="font-medium text-[#9a6729]">必填</span>
                        <select value={line.classGroupId} onChange={(event) => updateLine(line.key, { classGroupId: event.target.value })} className={fieldClass}>
                          <option value="">请选择班级</option>
                          {course.classGroups.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </select>
                        {course.classGroups.length === 0 ? <span className="font-medium text-[#9a6729]">这门课程还没有班级，请先到课程与班级里创建。</span> : null}
                      </label>
                    ) : null}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="grid gap-1.5 text-xs font-bold">
                        应收金额
                        <input value={line.amountDue} onChange={(event) => updateLine(line.key, { amountDue: event.target.value })} type="number" min="0" step="0.01" className={fieldClass} />
                      </label>
                      <label className="grid gap-1.5 text-xs font-bold">
                        实收金额
                        <input value={line.amount} onChange={(event) => updateLine(line.key, { amount: event.target.value })} type="number" min="0" step="0.01" className={fieldClass} />
                      </label>
                    </div>
                    {byPeriod ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="grid gap-1.5 text-xs font-bold">
                          有效期开始时间 <span className="font-medium text-[#9a6729]">必填</span>
                          <DateField value={line.startDate} onChange={(startDate) => updateLine(line.key, { startDate })} required className={fieldClass} />
                        </label>
                        <label className="grid gap-1.5 text-xs font-bold">
                          有效期结束时间 <span className="font-medium text-[#9a6729]">必填</span>
                          <DateField value={line.endDate} onChange={(endDate) => updateLine(line.key, { endDate })} required className={fieldClass} />
                        </label>
                      </div>
                    ) : course ? (
                      <label className="grid gap-1.5 text-xs font-bold">
                        购买课时数 <span className="font-medium text-[#9a6729]">必填</span>
                        <input value={line.hoursAdded} onChange={(event) => updateLine(line.key, { hoursAdded: event.target.value })} type="number" min="1" max="500" step="1" className={fieldClass} />
                      </label>
                    ) : (
                      <p className="text-xs text-[var(--muted)]">选择课程后，按课时填写节数，按周期填写有效期。</p>
                    )}
                  </div>
                );
              })}
              <button type="button" disabled={lines.length >= 12 || courses.length === 0} onClick={() => setLines((current) => [...current, blankLine()])} className="w-fit text-xs font-bold text-[var(--teal)] disabled:opacity-50">＋ 添加一门课程</button>
            </div>
            {courses.length === 0 ? <p className="mt-3 text-xs text-[#9a6729]">还没有在用的课程。请先到课程与班级里创建。</p> : null}
            {message ? <p className="mt-3 text-xs text-[#b94d4d]">{message}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => { setOpen(false); setMessage(""); setFailed(false); }} className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold">取消</button>
              <button disabled={pending || courses.length === 0} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">{pending ? "正在保存…" : "保存"}</button>
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
