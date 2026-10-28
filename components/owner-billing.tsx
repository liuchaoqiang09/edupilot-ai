"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { createEnrollment } from "@/app/owner/billing/actions";
import { adjustHours, collectPayment, refundPayment, voidCollectedPayment } from "@/app/owner/billing/ledger-actions";
import { paymentMethods, paymentMethodLabel } from "@/lib/enrollment-money";
import { deactivateStudent } from "@/app/owner/students/actions";
import { DateField, isCalendarDate } from "@/components/date-field";
import { RenewalFollowUpForm } from "@/components/renewal-follow-up";
import { InstantSearch } from "@/components/instant-search";
import { Modal } from "@/components/modal";
import { SortHeader } from "@/components/sort-header";
import { useLocale, usePick, usePublicLabel } from "@/components/locale-provider";
import { StudentCombobox, type DirectoryStudent } from "@/components/student-combobox";
import { billingQuickFilters, lowHourStatusThreshold, soonStatusDays, type BillingQuickFilter, type BillingSortField } from "@/lib/billing-list";
import type { PeriodValidity } from "@/lib/course-hours";
import type { SortOrder } from "@/lib/table-sort";
import { parseAge, parseMainlandPhone, studentFacts, unenrolledBadgeClass } from "@/lib/student-profile";

export type BillingPayment = {
  id: string;
  amountText: string;
  methodLabel: string;
  paidAtLabel: string;
  reason: string | null;
  voided: boolean;
  voidReason: string | null;
};

export type BillingAccount = {
  id: string;
  label: string;
  dueText: string;
  discountText: string | null;
  receivedText: string;
  payments: BillingPayment[];
};

export type BillingStudent = {
  rowKey: string;
  id: string;
  name: string;
  studentNo: string | null;
  grade: string | null;
  age: number | null;
  courseName: string;
  hoursText: string;
  validityText: string;
  remainingHours: number | null;
  validUntil: string | null;
  paidAtTime: number | null;
  billingType: "PER_LESSON" | "PER_PERIOD" | null;
  periodStatus: PeriodValidity | null;
  usageStatus: string;
  lastPaid: string;
  followUp: boolean;
  latestFollowUp?: string | null;
  arrears: boolean;
  money: { dueText: string; payableText: string; receivedText: string; gapText: string } | null;
  accounts: BillingAccount[];
  enrolled: boolean;
  canDeactivate: boolean;
  courseId?: string;
};

const quickFilterLabels: Record<BillingQuickFilter | "全部" | "欠费", [string, string]> = {
  全部: ["全部", "All"],
  未报名: ["未报名", "Not enrolled"],
  已过期: ["已过期/0课时", "Expired / no hours"],
  即将过期: ["即将过期/课时不足", "Expiring / low hours"],
  欠费: ["欠费", "Outstanding"],
};

function statusBadgeClass(status: string) {
  if (status === "未报名") return unenrolledBadgeClass;
  if (status === "课时不足") return "bg-[#e7eefb] text-[#24548f]";
  if (status === "即将过期") return "bg-[#f3e9fb] text-[#6b3a86]";
  if (status === "已过期" || status === "无课时" || status === "未填写有效期") return "bg-[#fff2df] text-[#9a6729]";
  return "bg-[#edf5f1] text-[#34725d]";
}

function billingHref(input: { query?: string; status?: string | null; sortBy?: BillingSortField | null; order?: SortOrder | null }) {
  const params = new URLSearchParams();
  if (input.query) params.set("q", input.query);
  if (input.status) params.set("status", input.status);
  if (input.sortBy && input.order) {
    params.set("sortBy", input.sortBy);
    params.set("order", input.order);
  }
  const text = params.toString();
  return text ? `/owner/billing?${text}` : "/owner/billing";
}

const fieldClass = "rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]";

function filterHint(statusFilter: BillingQuickFilter | "待续费" | "欠费" | null, query: string, t: (zh: string, en: string) => string) {
  const scope = query ? t(`当前搜索「${query}」。`, `Search “${query}”. `) : "";
  if (statusFilter === "待续费") return `${scope}${t("当前正在筛选：待续费。包含课时不足、无课时、已过期、未填写有效期和即将过期。", "Showing renewals: low hours, no hours, expired, missing end date, and expiring soon.")}`;
  if (statusFilter === "未报名") return `${scope}${t("只显示还没有报名记录的学员。", "Students with no enrollment.")}`;
  if (statusFilter === "已过期") return `${scope}${t("只显示周期课程已过期，或按课时课程剩余 0 节的报名。刚过期的排在前面，没有有效期的排在最后。", "Expired term courses, or lesson courses with 0 hours left.")}`;
  if (statusFilter === "即将过期") return `${scope}${t(`只显示即将过期和课时不足。周期课程在结束前 ${soonStatusDays} 天内才算即将过期，按课时剩余 1 到 ${lowHourStatusThreshold} 节才算课时不足。`, `Expiring soon means a term ends within ${soonStatusDays} days. Low hours means 1 to ${lowHourStatusThreshold} lessons left.`)}`;
  if (statusFilter === "欠费") return `${scope}${t("只显示折后应收大于未作废实收的报名。没有填写折扣时，折后应收就是应收。作废的收款不计入实收。", "Outstanding means valid payments are below the discounted amount due. With no discount, that is the full amount due.")}`;
  return `${scope}${t("按课时显示剩余节数，按周期显示有效期。", "Lesson courses show hours left. Term courses show the end date.")}`;
}

function emptyBillingCopy(statusFilter: BillingQuickFilter | "待续费" | "欠费" | null, query: string, t: (zh: string, en: string) => string) {
  if (query || statusFilter) return t("没有找到符合条件的学员。", "No matching students.");
  return t("还没有在读学员。请先到学生管理里添加。", "No active students yet.");
}

type EnrollmentDraft = {
  key: string;
  courseId: string;
  classGroupId: string;
  amountDue: string;
  discountPercent: string;
  amount: string;
  payMethod: "CASH" | "WECHAT" | "ALIPAY" | "BANK" | "OTHER";
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
    discountPercent: "",
    amount: "0.00",
    payMethod: "CASH",
    hoursAdded: "12",
    startDate: "",
    endDate: "",
  };
}

function discountRate(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return 100;
  const match = /^(\d+(?:\.\d{1,2})?)%$/.exec(trimmed);
  if (!match) return null;
  const value = Number(match[1]);
  if (value < 0 || value > 100) return null;
  return value;
}

function actualCharge(due: string, discount: string) {
  const rate = discountRate(discount);
  const amount = Number(due);
  if (rate == null || !Number.isFinite(amount)) return "—";
  return (Math.round(Math.round(amount * 100) * rate / 100) / 100).toFixed(2);
}

export function OwnerBilling({
  students,
  directory,
  courses,
  stats,
  query = "",
  statusFilter = null,
  sortBy,
  order,
  prefill = null,
  openFormKey = "",
  openPanel = "",
  openRowKey = "",
  openStudentId = "",
  renewalHref = null,
  pinRenewals = false,
  focusKey = "",
}: {
  students: BillingStudent[];
  directory: DirectoryStudent[];
  courses: { id: string; name: string; billingType: "PER_LESSON" | "PER_PERIOD"; classGroups: { id: string; name: string; full?: boolean }[] }[];
  stats: { enrollments: number; compare: string; income: string; renewing: number; review: number };
  query?: string;
  statusFilter?: BillingQuickFilter | "待续费" | "欠费" | null;
  sortBy: BillingSortField | null;
  order: SortOrder | null;
  prefill?: { studentId: string; courseId: string; lessonStudentId: string } | null;
  openFormKey?: string;
  openPanel?: "" | "adjust" | "pay" | "follow";
  openRowKey?: string;
  openStudentId?: string;
  renewalHref?: string | null;
  pinRenewals?: boolean;
  focusKey?: string;
}) {
  const router = useRouter();
  const locale = useLocale();
  const t = usePick();
  const show = usePublicLabel();
  const [open, setOpen] = useState(false);
  const [retiring, setRetiring] = useState<BillingStudent | null>(null);
  const [adjusting, setAdjusting] = useState<BillingStudent | null>(null);
  const [ledger, setLedger] = useState<BillingStudent | null>(null);
  const [arrearsRow, setArrearsRow] = useState<BillingStudent | null>(null);
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [studentId, setStudentId] = useState("");
  const [studentName, setStudentName] = useState("");
  const [guardianName, setGuardianName] = useState("");
  const [guardianPhone, setGuardianPhone] = useState("");
  const [grade, setGrade] = useState("");
  const [age, setAge] = useState("");
  const [lines, setLines] = useState<EnrollmentDraft[]>([blankLine()]);
  const [lessonStudentId, setLessonStudentId] = useState("");
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const followUps = stats.renewing;

  function runOnce(task: () => Promise<void>) {
    if (submitting.current || pending) return;
    submitting.current = true;
    startTransition(async () => {
      try {
        await task();
      } finally {
        submitting.current = false;
      }
    });
  }

  useEffect(() => {
    if (!open && !adjusting && !ledger) {
      setDirty(false);
      return;
    }
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [open, adjusting, ledger, dirty]);

  useEffect(() => {
    const row = focusKey
      ? students.find((student) => student.rowKey === focusKey)
      : pinRenewals
        ? students.find((student) => student.followUp)
        : null;
    if (!row) return;
    document.getElementById(`billing-${row.rowKey}`)?.scrollIntoView({ block: "start" });
  }, [focusKey, pinRenewals, students]);

  useEffect(() => {
    if (!prefill?.studentId || !prefill.courseId) return;
    setMode("existing");
    setStudentId(prefill.studentId);
    const chosen = directory.find((student) => student.id === prefill.studentId);
    setGuardianName(chosen?.guardianName ?? "");
    setGuardianPhone(chosen?.guardianPhone ?? "");
    setLines([blankLine(prefill.courseId)]);
    setLessonStudentId(prefill.lessonStudentId);
    setOpen(true);
    // 只在从课次点「转为报名」进入时打开一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.studentId, prefill?.courseId, prefill?.lessonStudentId]);

  useEffect(() => {
    if (!openFormKey) return;
    setLessonStudentId("");
    setMessage("");
    setFailed(false);
    if (openStudentId) {
      setMode("existing");
      setStudentId(openStudentId);
      const chosen = directory.find((student) => student.id === openStudentId);
      setGuardianName(chosen?.guardianName ?? "");
      setGuardianPhone(chosen?.guardianPhone ?? "");
      setStudentName("");
      setGrade("");
      setAge("");
      setLines([blankLine()]);
      setOpen(true);
      return;
    }
    setMode("new");
    setStudentId("");
    setStudentName("");
    setGuardianName("");
    setGuardianPhone("");
    setGrade("");
    setAge("");
    setLines([blankLine()]);
    setOpen(true);
  }, [openFormKey, openStudentId, directory]);

  useEffect(() => {
    if (!openRowKey || (openPanel !== "adjust" && openPanel !== "pay")) return;
    const row = students.find((student) => student.rowKey === openRowKey);
    if (!row) return;
    if (openPanel === "adjust" && row.billingType === "PER_LESSON" && row.courseId) setAdjusting(row);
    if (openPanel === "pay" && row.enrolled && row.accounts.length > 0) setLedger(row);
  }, [openPanel, openRowKey, students]);

  function openEnrollment(nextStudentId = "", courseId = "") {
    setLessonStudentId("");
    setMode(nextStudentId ? "existing" : "new");
    setStudentId(nextStudentId);
    setStudentName("");
    const chosen = directory.find((student) => student.id === nextStudentId);
    setGuardianName(chosen?.guardianName ?? "");
    setGuardianPhone(chosen?.guardianPhone ?? "");
    setGrade("");
    setAge("");
    setLines([blankLine(courseId)]);
    setMessage("");
    setFailed(false);
    setOpen(true);
  }

  function updateLine(key: string, patch: Partial<EnrollmentDraft>) {
    setLines((current) => current.map((line) => {
      if (line.key !== key) return line;
      const next = { ...line, ...patch };
      const touchesPrice = "amountDue" in patch || "discountPercent" in patch;
      if (!touchesPrice || "amount" in patch) return next;
      const discount = next.discountPercent.trim();
      if (discount && discountRate(discount) == null) return next;
      const charge = actualCharge(next.amountDue, discount);
      return charge === "—" ? next : { ...next, amount: charge };
    }));
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
    const parsedPhone = parseMainlandPhone(guardianPhone, true);
    if (parsedPhone.error) {
      setFailed(true);
      setMessage(parsedPhone.error);
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
      if (discountRate(line.discountPercent) == null) {
        setFailed(true);
        setMessage("折扣率请填写百分数，例如 80%。");
        return;
      }
    }
    const formData = new FormData();
    formData.set("mode", mode);
    formData.set("studentId", studentId);
    formData.set("studentName", studentName.trim());
    formData.set("guardianName", guardianName.trim());
    formData.set("guardianPhone", guardianPhone.trim());
    formData.set("grade", grade.trim());
    formData.set("age", age.trim());
    formData.set("count", String(lines.length));
    lines.forEach((line, index) => {
      formData.set(`courseId:${index}`, line.courseId);
      formData.set(`classGroupId:${index}`, line.classGroupId);
      formData.set(`amountDue:${index}`, line.amountDue);
      formData.set(`discountPercent:${index}`, line.discountPercent.trim());
      formData.set(`amount:${index}`, line.amount);
      formData.set(`payMethod:${index}`, line.payMethod);
      formData.set(`hoursAdded:${index}`, line.hoursAdded);
      formData.set(`startDate:${index}`, line.startDate);
      formData.set(`endDate:${index}`, line.endDate);
    });
    setMessage("");
    setFailed(false);
    runOnce(async () => {
      const result = await createEnrollment(formData);
      setFailed(!result.ok);
      setMessage(result.message || (result.ok ? "已保存。" : "保存失败。"));
      if (result.ok) {
        setOpen(false);
        setDirty(false);
        router.refresh();
      }
    });
  }

  function retire(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!retiring?.courseId) return;
    setMessage("");
    setFailed(false);
    runOnce(async () => {
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
          <h1 className="text-[28px] font-semibold tracking-tight">{t("报名与课时", "Enrollment")}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-[var(--muted)]">{t("按课时的课程记录剩余节数。按周期的课程记录有效期，出勤不扣课时。", "Lesson courses track hours left. Term courses track the end date and do not deduct hours.")}</p>
        </div>
        <button type="button" onClick={() => openEnrollment()} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white">{t("＋ 记录报名", "+ Record enrollment")}</button>
      </div>
      {message && !open ? <p className={`mt-4 rounded-xl px-4 py-3 text-xs leading-6 ${failed ? "bg-[#fff4ec] text-[#9a4b24]" : "bg-[#f0f6ee] text-[#4e6c5c]"}`}>{message}</p> : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card icon="♙" label={t("本月报名", "Enrollments this month")} value={String(stats.enrollments)} foot={stats.compare} />
        <Card icon="¥" label={t("本月实收记录", "Collected this month")} value={stats.income} foot={t("根据已保存的实收金额汇总", "From saved payments")} />
        <Card icon="◷" label={t("即将续费", "Renewals")} value={String(stats.renewing)} foot={t("剩余 1 到 5 节、无课时，或周期课程已过期、5 天内到期", "1 to 5 hours left, no hours, expired, or ending within 5 days")} />
        <Card icon="!" label={t("课时待核对", "Hours to review")} value={String(stats.review)} foot={t("本月请假，未扣课时", "Excused absences this month, no hour deducted")} />
      </div>

      <section className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf0ee] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">{t("学员课时", "Hours and terms")}</h2>
            <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">{filterHint(statusFilter, query, t)}</p>
          </div>
          {renewalHref ? (
            <Link href={renewalHref} className="rounded-full bg-[#fff2df] px-2 py-1 text-[10px] font-bold text-[#9a6729]">{followUps} {t("位待续费", "to renew")}</Link>
          ) : (
            <span className="rounded-full bg-[#fff2df] px-2 py-1 text-[10px] font-bold text-[#9a6729]">{followUps} {t("位待续费", "to renew")}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-[#edf0ee] px-5 py-3">
          {(["全部", ...billingQuickFilters, "欠费"] as const).map((filter) => {
            const active = filter === "全部" ? statusFilter == null : statusFilter === filter;
            return (
              <Link
                key={filter}
                href={billingHref({ query, status: filter === "全部" ? null : filter })}
                aria-current={active ? "page" : undefined}
                className={`rounded-full px-3 py-1.5 text-xs font-bold ${active ? "bg-[var(--teal)] text-white" : "border border-[var(--line)] bg-white text-[#385058]"}`}
              >
                {t(quickFilterLabels[filter][0], quickFilterLabels[filter][1])}
              </Link>
            );
          })}
        </div>
        <InstantSearch
          action="/owner/billing"
          query={query}
          placeholder={t("搜索学员或课程", "Search students or courses")}
          params={{ status: statusFilter, sortBy, order }}
          resetLabel="重置"
          className="flex flex-wrap gap-2 border-b border-[#edf0ee] px-5 py-3"
          inputClassName="w-full rounded-[10px] border border-[var(--line)] bg-white px-3 py-2.5 text-sm outline-none focus:border-[var(--teal)] sm:w-auto sm:min-w-[220px] sm:flex-1"
        />
        {students.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm leading-7 text-[var(--muted)]">{emptyBillingCopy(statusFilter, query, t)}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] table-fixed border-collapse text-left text-xs">
              <colgroup>
                <col className="w-[18%]" />
                <col className="w-[16%]" />
                <col className="w-[10%]" />
                <col className="w-[12%]" />
                <col className="w-[16%]" />
                <col className="w-[8%]" />
                <col className="w-[20%]" />
              </colgroup>
              <thead className="bg-[#fafbf9] text-[10px] tracking-wide text-[#84918e]">
                <tr>
                  <SortHeader label={t("学员", "Student")} field="name" sortBy={sortBy} order={order} pathname="/owner/billing" query={query} extra={statusFilter ? { status: statusFilter } : undefined} />
                  <SortHeader label={t("报名课程", "Course")} field="course" sortBy={sortBy} order={order} pathname="/owner/billing" query={query} extra={statusFilter ? { status: statusFilter } : undefined} />
                  <SortHeader label={t("剩余课时", "Hours")} field="hours" sortBy={sortBy} order={order} pathname="/owner/billing" query={query} extra={statusFilter ? { status: statusFilter } : undefined} />
                  <SortHeader label={t("有效期", "End date")} field="validUntil" sortBy={sortBy} order={order} pathname="/owner/billing" query={query} extra={statusFilter ? { status: statusFilter } : undefined} />
                  <SortHeader label={t("最近缴费", "Last payment")} field="paidAt" sortBy={sortBy} order={order} pathname="/owner/billing" query={query} extra={statusFilter ? { status: statusFilter } : undefined} />
                  <SortHeader label={t("状态", "Status")} field="status" sortBy={sortBy} order={order} pathname="/owner/billing" query={query} extra={statusFilter ? { status: statusFilter } : undefined} />
                  <th className="px-4 py-3 font-extrabold">{t("操作", "Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr id={`billing-${student.rowKey}`} key={student.rowKey} className={`scroll-mt-24 border-t border-[#eef1ee] ${focusKey === student.rowKey || (pinRenewals && student.followUp) ? "bg-[#fff8ee]" : ""}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="grid h-8 w-8 place-items-center rounded-full bg-[#dcece5] text-xs font-extrabold text-[#215a52]">{student.name.slice(0, 1)}</span>
                        <span>
                          <strong className="block">{student.name}</strong>
                          <span className="text-[11px] text-[var(--muted)]">{studentFacts(student.grade, student.age, locale)}</span>
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">{student.courseName === "还没有报名课程" ? t("还没有报名课程", "No enrollment yet") : student.courseName}</td>
                    <td className="px-4 py-3">{show(student.hoursText)}</td>
                    <td className="px-4 py-3">{student.validityText === "未填写" ? t("未填写", "Not set") : show(student.validityText)}</td>
                    <td className="px-4 py-3">{student.lastPaid === "还没有缴费" ? t("还没有缴费", "No payment yet") : student.lastPaid}{student.arrears && student.money ? <button type="button" onClick={() => setArrearsRow(student)} className="ml-2 rounded-full bg-[#fff2df] px-2 py-1 text-[10px] font-bold text-[#9a6729]">{t("欠费", "Outstanding")}</button> : null}{student.latestFollowUp ? <span className="mt-1 block text-[11px] text-[var(--muted)]">最近跟进：{student.latestFollowUp}</span> : null}</td>
                    <td className="px-4 py-3">
                      <span className={`whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-bold ${statusBadgeClass(student.usageStatus)}`}>
                        {show(student.usageStatus)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => openEnrollment(student.id, student.courseId ?? "")} className="font-bold text-[var(--teal)]">{t("记录报名", "Enroll")}</button>
                      {student.billingType === "PER_LESSON" && student.courseId ? (
                        <button type="button" onClick={() => { setAdjusting(student); setMessage(""); setFailed(false); }} className="ml-3 font-bold text-[var(--teal)]">{t("调整课时", "Adjust hours")}</button>
                      ) : null}
                      {student.enrolled && student.accounts.length > 0 ? (
                        <button type="button" onClick={() => { setLedger(student); setMessage(""); setFailed(false); }} className="ml-3 font-bold text-[var(--teal)]">{t("收款流水", "Payments")}</button>
                      ) : null}
                      {student.followUp && student.courseId ? <RenewalFollowUpForm studentId={student.id} courseId={student.courseId} startOpen={focusKey === student.rowKey} /> : null}
                      {student.canDeactivate && student.courseId ? (
                        <button type="button" onClick={() => { setRetiring(student); setReason(""); setMessage(""); setFailed(false); }} className="ml-3 font-bold text-[#74838b]">{t("停用学生", "Deactivate")}</button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-[#eef1ee] px-5 py-3 text-[11px] leading-6 text-[var(--muted)]">{t("按课时课程：出勤、迟到或缺勤扣这节课所属课程 1 课时。按周期课程不扣课时。请假和未标记会退回此前实际扣掉的那 1 课时。", "Lesson courses deduct 1 hour for present, late, or absent. Term courses do not. Excused and unmarked attendance give that hour back.")}</p>
      </section>

      {arrearsRow?.money ? (
        <Modal title={t("欠费说明", "Why this is outstanding")} onClose={() => setArrearsRow(null)}>
          <ArrearsDetail student={arrearsRow} onClose={() => setArrearsRow(null)} />
        </Modal>
      ) : null}

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
        <Modal title="记录报名" onClose={() => {
          if (dirty && !window.confirm("报名内容还没保存，确定关闭吗？")) return;
          setOpen(false);
          setDirty(false);
          setMessage("");
          setFailed(false);
        }}>
          <form onSubmit={submit} onInput={() => setDirty(true)} className="px-5 py-5">
            {lessonStudentId ? <input type="hidden" name="lessonStudentId" value={lessonStudentId} /> : null}
            <div className="grid gap-3">
              <div className="flex rounded-[10px] border border-[var(--line)] bg-white p-1">
                <button type="button" onClick={() => { setMode("new"); setGuardianName(""); setGuardianPhone(""); }} className={`flex-1 rounded-lg px-3 py-2 text-xs font-bold ${mode === "new" ? "bg-[var(--teal)] text-white" : "text-[#385058]"}`}>新生报名</button>
                <button type="button" onClick={() => { const chosen = directory.find((student) => student.id === studentId); setMode("existing"); setGuardianName(chosen?.guardianName ?? ""); setGuardianPhone(chosen?.guardianPhone ?? ""); }} className={`flex-1 rounded-lg px-3 py-2 text-xs font-bold ${mode === "existing" ? "bg-[var(--teal)] text-white" : "text-[#385058]"}`}>老生续费/加报</button>
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
                  <StudentCombobox students={directory} value={studentId} onChange={(id) => { const chosen = directory.find((student) => student.id === id); setStudentId(id); setGuardianName(chosen?.guardianName ?? ""); setGuardianPhone(chosen?.guardianPhone ?? ""); }} />
                </label>
              )}
              <label className="grid gap-1.5 text-xs font-bold">
                家长姓名 <span className="font-medium text-[#9a6729]">必填</span>
                <input value={guardianName} onChange={(event) => setGuardianName(event.target.value)} readOnly={mode === "existing" && Boolean(directory.find((student) => student.id === studentId)?.guardianName)} placeholder="请输入家长姓名" className={fieldClass} />
                {mode === "existing" && directory.find((student) => student.id === studentId)?.guardianName ? <span className="font-medium text-[var(--muted)]">这位学员已经有家长姓名。要修改，请到学生管理里编辑。</span> : null}
              </label>
              <label className="grid gap-1.5 text-xs font-bold">
                联系人电话 <span className="font-medium text-[#9a6729]">必填</span>
                <input value={guardianPhone} onChange={(event) => setGuardianPhone(event.target.value)} inputMode="numeric" placeholder="请输入 11 位手机号" className={fieldClass} />
                <span className="font-medium text-[var(--muted)]">保存后写到这名学生的档案，学生管理里点查看可以看到。</span>
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
                          {course.classGroups.map((item) => <option key={item.id} value={item.id}>{item.name}{item.full ? " · 已满" : ""}</option>)}
                        </select>
                        {course.classGroups.length === 0 ? <span className="font-medium text-[#9a6729]">这门课程还没有班级，请先到课程与班级里创建。</span> : null}
                      </label>
                    ) : null}
                    <div className="grid gap-3 sm:grid-cols-3">
                      <label className="grid gap-1.5 text-xs font-bold">
                        应收金额
                        <input value={line.amountDue} onChange={(event) => updateLine(line.key, { amountDue: event.target.value })} type="number" min="0" step="0.01" className={fieldClass} />
                      </label>
                      <label className="grid gap-1.5 text-xs font-bold">
                        折扣率
                        <input value={line.discountPercent} onChange={(event) => updateLine(line.key, { discountPercent: event.target.value })} placeholder="例如 80%" className={fieldClass} />
                      </label>
                      <label className="grid gap-1.5 text-xs font-bold">
                        实收金额
                        <input value={line.amount} onChange={(event) => updateLine(line.key, { amount: event.target.value })} type="number" min="0" step="0.01" className={fieldClass} />
                      </label>
                    </div>
                    <label className="grid gap-1.5 text-xs font-bold">
                      收款方式
                      <select value={line.payMethod} onChange={(event) => updateLine(line.key, { payMethod: event.target.value as EnrollmentDraft["payMethod"] })} className={fieldClass}>
                        {paymentMethods.map((method) => <option key={method} value={method}>{paymentMethodLabel[method]}</option>)}
                      </select>
                      <span className="font-medium text-[var(--muted)]">实收大于 0 时记成一笔收款。之后可以继续收款、退费或作废。</span>
                    </label>
                    <p className="text-xs leading-6 text-[var(--muted)]">折扣率带百分号，例如 80%。实际收费 = 应收 × 折扣率，当前为 {actualCharge(line.amountDue, line.discountPercent)} 元。留空表示不打折。</p>
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
      {adjusting ? (
        <HourAdjustModal
          student={adjusting}
          pending={pending}
          message={failed ? message : ""}
          onClose={() => setAdjusting(null)}
          onSubmit={(formData) => {
            setMessage("");
            setFailed(false);
            runOnce(async () => {
              const result = await adjustHours(formData);
              setFailed(!result.ok);
              setMessage(result.message ?? "");
              if (result.ok) {
                setAdjusting(null);
                router.refresh();
              }
            });
          }}
        />
      ) : null}
      {ledger ? (
        <PaymentModal
          student={ledger}
          pending={pending}
          message={failed ? message : ""}
          onClose={() => setLedger(null)}
          onDone={(result) => {
            setFailed(!result.ok);
            setMessage(result.message ?? "");
            if (result.ok) {
              setLedger(null);
              router.refresh();
            }
          }}
          start={(action) => {
            setMessage("");
            setFailed(false);
            runOnce(action);
          }}
        />
      ) : null}
    </section>
  );
}

function shanghaiNowInput() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
}

function HourAdjustModal({
  student,
  pending,
  message,
  onClose,
  onSubmit,
}: {
  student: BillingStudent;
  pending: boolean;
  message: string;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
}) {
  return (
    <Modal title={`调整课时 · ${student.name}`} onClose={onClose}>
      <form
        className="space-y-4 px-5 py-5"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(new FormData(event.currentTarget));
        }}
      >
        <input type="hidden" name="studentId" value={student.id} />
        <input type="hidden" name="courseId" value={student.courseId ?? ""} />
        <p className="text-sm leading-6 text-[var(--muted)]">{student.courseName}，当前{student.hoursText}。正数增加，负数减少。减完不能小于 0。</p>
        <label className="grid gap-1.5 text-xs font-bold">
          增减节数 <span className="font-medium text-[#9a6729]">必填</span>
          <input name="deltaHours" type="number" required step="1" min="-500" max="500" placeholder="例如 1 或 -1" className={fieldClass} />
        </label>
        <label className="grid gap-1.5 text-xs font-bold">
          原因 <span className="font-medium text-[#9a6729]">必填</span>
          <input name="reason" required maxLength={80} placeholder="例如：赠课、记错冲正" className={fieldClass} />
        </label>
        {message ? <p className="text-xs text-[#b94d4d]">{message}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-[10px] border border-[var(--line)] px-3.5 py-2.5 text-xs font-bold">取消</button>
          <button disabled={pending} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">{pending ? "正在保存…" : "保存"}</button>
        </div>
      </form>
    </Modal>
  );
}

function ArrearsDetail({ student, onClose }: { student: BillingStudent; onClose: () => void }) {
  const t = usePick();
  const show = usePublicLabel();
  const money = student.money;
  if (!money) return null;
  const discounts = [...new Set(student.accounts.map((account) => account.discountText))];
  const reason = discounts.length === 1 && discounts[0] == null
    ? t(
        `没有填写折扣，折后应收就是应收 ${money.dueText}。未作废实收是 ${money.receivedText}，还差 ${money.gapText}。`,
        `No discount was entered, so the amount due stays ${money.dueText}. Valid payments total ${money.receivedText}, short by ${money.gapText}.`,
      )
    : discounts.length === 1
      ? t(
          `折扣是 ${discounts[0]}，折后应收是 ${money.payableText}。未作废实收是 ${money.receivedText}，还差 ${money.gapText}。`,
          `The discount is ${discounts[0]}, so the discounted amount due is ${money.payableText}. Valid payments total ${money.receivedText}, short by ${money.gapText}.`,
        )
      : t(
          `这门课有多笔报名，折扣不相同。折后应收合计 ${money.payableText}，未作废实收合计 ${money.receivedText}，还差 ${money.gapText}。`,
          `This course has more than one enrollment, with different discounts. Discounted amounts due total ${money.payableText}. Valid payments total ${money.receivedText}, short by ${money.gapText}.`,
        );
  return (
    <div className="space-y-4 px-5 py-5 text-sm">
      <p className="font-bold">{student.name} · {student.courseName}</p>
      <dl className="grid grid-cols-2 gap-3 rounded-xl bg-[#f7faf8] px-3 py-3 text-xs sm:grid-cols-4">
        <div><dt className="text-[var(--muted)]">{t("应收", "Amount due")}</dt><dd className="mt-1 font-bold">{money.dueText}</dd></div>
        <div><dt className="text-[var(--muted)]">{t("折扣", "Discount")}</dt><dd className="mt-1 font-bold">{discounts.length === 1 ? (discounts[0] ?? t("没有填写", "None")) : t("各笔不同", "Mixed")}</dd></div>
        <div><dt className="text-[var(--muted)]">{t("折后应收", "Discounted due")}</dt><dd className="mt-1 font-bold">{money.payableText}</dd></div>
        <div><dt className="text-[var(--muted)]">{t("未作废实收", "Valid payments")}</dt><dd className="mt-1 font-bold">{money.receivedText}</dd></div>
      </dl>
      <p className="leading-7 text-[var(--muted)]">{reason}{t("作废的收款不计入实收。", " Voided payments are excluded.")}{t(`旁边的「${show(student.usageStatus)}」表示课时或有效期，和这笔钱是否收齐是分开的。`, ` The “${show(student.usageStatus)}” label is hours or the course period, separate from whether the money is paid.`)}</p>
      <p className="text-xs font-bold text-[#9a6729]">{t("还差", "Short by")} {money.gapText}</p>
      {student.accounts.length > 1 ? (
        <ul className="space-y-2">
          {student.accounts.map((account) => <li key={account.id} className="rounded-xl bg-[#f7faf8] px-3 py-2 text-xs">{account.label}</li>)}
        </ul>
      ) : null}
      <div className="flex justify-end">
        <button type="button" onClick={onClose} className="rounded-[10px] border border-[var(--line)] px-3.5 py-2.5 text-xs font-bold">{t("关闭", "Close")}</button>
      </div>
    </div>
  );
}

function PaymentModal({
  student,
  pending,
  message,
  onClose,
  onDone,
  start,
}: {
  student: BillingStudent;
  pending: boolean;
  message: string;
  onClose: () => void;
  onDone: (result: { ok: boolean; message?: string }) => void;
  start: (action: () => Promise<void>) => void;
}) {
  const [enrollmentId, setEnrollmentId] = useState(student.accounts[0]?.id ?? "");
  const [kind, setKind] = useState<"collect" | "refund">("collect");
  const [voiding, setVoiding] = useState<string | null>(null);
  const account = student.accounts.find((item) => item.id === enrollmentId) ?? student.accounts[0];
  return (
    <Modal title={`收款流水 · ${student.name}`} onClose={onClose}>
      <div className="space-y-4 px-5 py-5 text-sm">
        <p className="leading-6 text-[var(--muted)]">{student.courseName}。退费记成负数。作废后仍保留，不计入实收。</p>
        <label className="grid gap-1.5 text-xs font-bold">
          报名记录
          <select value={account?.id ?? ""} onChange={(event) => setEnrollmentId(event.target.value)} className={fieldClass}>
            {student.accounts.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        {account?.discountText ? (
          <dl className="grid grid-cols-3 gap-2 rounded-xl bg-[#f7faf8] px-3 py-2 text-xs">
            <div>
              <dt className="text-[var(--muted)]">应收</dt>
              <dd className="font-bold">{account.dueText}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">折扣</dt>
              <dd className="font-bold">{account.discountText}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">实收</dt>
              <dd className="font-bold">{account.receivedText}</dd>
            </div>
          </dl>
        ) : null}
        <ul className="space-y-2">
          {account && account.payments.length === 0 ? <li className="text-xs text-[var(--muted)]">还没有收款。</li> : null}
          {account?.payments.map((payment) => (
            <li key={payment.id} className="rounded-xl bg-[#f7faf8] px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={payment.voided ? "text-[var(--muted)] line-through" : "font-bold"}>{payment.amountText} 元 · {payment.methodLabel}</span>
                <span className="text-[var(--muted)]">{payment.paidAtLabel}</span>
              </div>
              {payment.reason ? <p className="mt-1 text-[var(--muted)]">{payment.reason}</p> : null}
              {payment.voided ? <p className="mt-1 text-[#9a6729]">已作废{payment.voidReason ? `：${payment.voidReason}` : ""}</p> : (
                <div className="mt-2 flex gap-3">
                  <Link href={`/owner/billing/payments/${payment.id}`} className="font-bold text-[var(--teal)]">打印收据</Link>
                  <button type="button" onClick={() => setVoiding(payment.id)} className="font-bold text-[#9a6729]">作废</button>
                </div>
              )}
              {voiding === payment.id ? (
                <form
                  className="mt-2 grid gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const formData = new FormData(event.currentTarget);
                    start(async () => onDone(await voidCollectedPayment(formData)));
                  }}
                >
                  <input type="hidden" name="paymentId" value={payment.id} />
                  <input name="reason" required maxLength={80} placeholder="作废原因" className={fieldClass} />
                  <button disabled={pending} className="w-fit rounded-[10px] bg-[#c27b35] px-3 py-2 text-xs font-bold text-white disabled:opacity-60">确认作废</button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
        <form
          className="grid gap-3 border-t border-[#eef1ee] pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            start(async () => onDone(await (kind === "refund" ? refundPayment(formData) : collectPayment(formData))));
          }}
        >
          <input type="hidden" name="enrollmentId" value={account?.id ?? ""} />
          <div className="flex gap-2 text-xs font-bold">
            <button type="button" onClick={() => setKind("collect")} className={`rounded-full px-3 py-1.5 ${kind === "collect" ? "bg-[var(--teal)] text-white" : "border border-[var(--line)]"}`}>收款</button>
            <button type="button" onClick={() => setKind("refund")} className={`rounded-full px-3 py-1.5 ${kind === "refund" ? "bg-[var(--teal)] text-white" : "border border-[var(--line)]"}`}>退费</button>
          </div>
          <label className="grid gap-1.5 text-xs font-bold">
            金额 <span className="font-medium text-[#9a6729]">必填</span>
            <input name="amount" required type="number" min="0.01" step="0.01" className={fieldClass} />
          </label>
          <label className="grid gap-1.5 text-xs font-bold">
            方式
            <select name="method" defaultValue="CASH" className={fieldClass}>
              {paymentMethods.map((method) => <option key={method} value={method}>{paymentMethodLabel[method]}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-bold">
            时间
            <input name="paidAt" type="datetime-local" required defaultValue={shanghaiNowInput()} className={fieldClass} />
          </label>
          <label className="grid gap-1.5 text-xs font-bold">
            {kind === "refund" ? "退费原因" : "说明"} {kind === "refund" ? <span className="font-medium text-[#9a6729]">必填</span> : <span className="font-medium text-[var(--muted)]">选填</span>}
            <input name="reason" required={kind === "refund"} maxLength={80} className={fieldClass} />
          </label>
          {message ? <p className="text-xs text-[#b94d4d]">{message}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-[10px] border border-[var(--line)] px-3.5 py-2.5 text-xs font-bold">关闭</button>
            <button disabled={pending || !account} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">{pending ? "正在保存…" : kind === "refund" ? "保存退费" : "保存收款"}</button>
          </div>
        </form>
      </div>
    </Modal>
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
