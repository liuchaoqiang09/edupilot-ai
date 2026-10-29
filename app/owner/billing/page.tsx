import { OwnerBilling, type BillingStudent } from "@/components/owner-billing";
import { Pager, billingPageSize, pageOf } from "@/components/pager";
import { renewalOutcomeLabel } from "@/lib/renewal-follow-up";
import type { DirectoryStudent } from "@/components/student-combobox";
import { billingSortFields, billingUsageLabel, compareBillingRows, compareBillingUrgency, compareCourseMates, matchesBillingFilter, matchesBillingQuery, needsBillingFollowUp, type BillingQuickFilter } from "@/lib/billing-list";
import { classIsFull } from "@/lib/class-occupancy";
import { canDeactivateEnrollment, periodValidity, calendarDateKey } from "@/lib/course-hours";
import { requireRole } from "@/lib/auth";
import { decimalCents, payableCents, paymentMethodLabel } from "@/lib/enrollment-money";
import { pick } from "@/lib/locale";
import { dayRange, shanghaiDateKey } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { readSort } from "@/lib/table-sort";

function monthRange(todayKey: string) {
  const [yearText, monthText] = todayKey.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const previousYear = month === 1 ? year - 1 : year;
  const previousMonth = month === 1 ? 12 : month - 1;
  return {
    start: dayRange(`${yearText}-${monthText}-01`).start,
    end: dayRange(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01`).start,
    previousStart: dayRange(`${previousYear}-${String(previousMonth).padStart(2, "0")}-01`).start,
  };
}

function yuan(value: { toString(): string } | null) {
  const amount = Number(value?.toString() ?? 0);
  return `¥ ${amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function orderBillingRows(rows: BillingStudent[], courseNames: string[]) {
  const groups = new Map<string, BillingStudent[]>();
  for (const row of rows) {
    const list = groups.get(row.courseName) ?? [];
    list.push(row);
    groups.set(row.courseName, list);
  }
  const ordered: BillingStudent[] = [];
  for (const name of courseNames) {
    const list = groups.get(name);
    if (!list) continue;
    ordered.push(...[...list].sort(compareCourseMates));
    groups.delete(name);
  }
  for (const list of groups.values()) ordered.push(...[...list].sort(compareCourseMates));
  return ordered;
}

export default async function OwnerBillingPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; sortBy?: string | string[]; order?: string | string[]; page?: string; enroll?: string; studentId?: string; courseId?: string; lessonStudentId?: string; pin?: string; focus?: string; form?: string; open?: string; panel?: string; who?: string }>;
}) {
  const user = await requireRole("OWNER", "owner");
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const statusFilter: BillingQuickFilter | "待续费" | "欠费" | null = params.status === "未报名" || params.status === "已过期" || params.status === "即将过期" || params.status === "待续费" || params.status === "欠费" ? params.status : null;
  const sort = readSort(params.sortBy, params.order, billingSortFields);
  const month = monthRange(shanghaiDateKey());
  const [students, courses, thisMonth, lastMonth, income, review] = await Promise.all([
    prisma.student.findMany({
      where: { organizationId: user.organizationId, status: "ACTIVE" },
      orderBy: [
        { name: sort?.sortBy === "name" ? sort.order : "asc" },
        { studentNo: { sort: "asc", nulls: "last" } },
      ],
      select: {
        id: true,
        name: true,
        grade: true,
        age: true,
        studentNo: true,
        contactNote: true,
        guardianName: true,
        guardianPhone: true,
        parentLinks: { select: { parent: { select: { phone: true } } } },
        enrollments: {
          orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
          select: {
            id: true,
            courseId: true,
            amountDue: true,
            discountPercent: true,
            amount: true,
            paidAt: true,
            createdAt: true,
            startDate: true,
            endDate: true,
            course: { select: { name: true, billingType: true } },
            classGroup: { select: { name: true } },
            payments: {
              orderBy: { paidAt: "desc" },
              select: {
                id: true,
                amount: true,
                method: true,
                paidAt: true,
                reason: true,
                voidedAt: true,
                voidReason: true,
              },
            },
          },
        },
        courseHourBalances: { select: { courseId: true, remainingHours: true } },
      },
    }),
    prisma.course.findMany({
      where: { organizationId: user.organizationId, status: "ACTIVE" },
      orderBy: [
        { name: sort?.sortBy === "course" ? sort.order : "asc" },
        { id: "asc" },
      ],
      select: {
        id: true,
        name: true,
        billingType: true,
        classGroups: {
          where: { status: "ACTIVE" },
          select: { id: true, name: true, capacity: true, enrollments: { where: { student: { status: "ACTIVE" } }, select: { studentId: true } } },
          orderBy: { name: "asc" },
        },
      },
    }),
    prisma.enrollment.count({ where: { organizationId: user.organizationId, createdAt: { gte: month.start, lt: month.end } } }),
    prisma.enrollment.count({ where: { organizationId: user.organizationId, createdAt: { gte: month.previousStart, lt: month.start } } }),
    prisma.payment.aggregate({
      where: { organizationId: user.organizationId, voidedAt: null, paidAt: { gte: month.start, lt: month.end } },
      _sum: { amount: true },
    }),
    prisma.lessonStudent.count({
      where: {
        organizationId: user.organizationId,
        attendanceStatus: "LEAVE",
        hoursCharged: false,
        lessonSession: { startAt: { gte: month.start, lt: month.end }, status: { not: "CANCELLED" } },
      },
    }),
  ]);
  const delta = Math.round(((thisMonth - lastMonth) / lastMonth) * 1000) / 10;
  const compare = lastMonth === 0
    ? (thisMonth === 0 ? pick(user.locale, "上月也是 0", "Last month was 0 too") : pick(user.locale, "上月为 0", "Last month was 0"))
    : pick(user.locale, `${delta > 0 ? "+" : ""}${delta}% 较上月`, `${delta > 0 ? "+" : ""}${delta}% vs last month`);
  const today = shanghaiDateKey();
  const directory: DirectoryStudent[] = students.map((student) => {
    const noted = student.contactNote?.match(/1[3-9]\d{9}/g) ?? [];
    const linked = student.parentLinks.map((link) => link.parent.phone).filter((phone): phone is string => Boolean(phone));
    const stored = student.guardianPhone ? [student.guardianPhone] : [];
    return {
      id: student.id,
      name: student.name,
      studentNo: student.studentNo,
      grade: student.grade,
      age: student.age,
      guardianName: student.guardianName,
      guardianPhone: student.guardianPhone,
      classNames: [...new Set(student.enrollments.flatMap((enrollment) => enrollment.classGroup?.name ? [enrollment.classGroup.name] : []))],
      phones: [...new Set([...stored, ...noted, ...linked])],
    };
  });
  const rows: BillingStudent[] = [];
  for (const student of students) {
    const byCourse = new Map<string, { name: string; billingType: "PER_LESSON" | "PER_PERIOD"; paidAt: Date | null; windows: { start: string; end: string }[]; dueCents: number; payableCents: number; netCents: number; accounts: BillingStudent["accounts"] }>();
    for (const enrollment of student.enrollments) {
      const current = byCourse.get(enrollment.courseId) ?? {
        name: enrollment.course.name,
        billingType: enrollment.course.billingType,
        paidAt: null,
        windows: [],
        dueCents: 0,
        payableCents: 0,
        netCents: 0,
        accounts: [],
      };
      if (enrollment.paidAt && (!current.paidAt || enrollment.paidAt > current.paidAt)) current.paidAt = enrollment.paidAt;
      if (enrollment.startDate && enrollment.endDate) {
        current.windows.push({ start: calendarDateKey(enrollment.startDate), end: calendarDateKey(enrollment.endDate) });
      }
      const due = decimalCents(enrollment.amountDue);
      const net = decimalCents(enrollment.amount);
      const discount = enrollment.discountPercent == null ? null : Number(enrollment.discountPercent);
      const dueText = (due / 100).toFixed(2);
      const receivedText = (net / 100).toFixed(2);
      const discountText = enrollment.discountPercent == null ? null : `${Number(enrollment.discountPercent)}%`;
      const dated = enrollment.createdAt.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });
      current.dueCents += due;
      current.payableCents += payableCents(due, discount);
      current.netCents += net;
      current.accounts.push({
        id: enrollment.id,
        dueText,
        discountText,
        receivedText,
        label: discountText
          ? `${dated} · 应收 ${dueText} · 折扣 ${discountText} · 实收 ${receivedText}`
          : `${dated} · 应收 ${dueText} · 已收 ${receivedText}`,
        payments: enrollment.payments.map((payment) => ({
          id: payment.id,
          amountText: `${Number(payment.amount) < 0 ? "" : "+"}${Number(payment.amount).toFixed(2)}`,
          methodLabel: paymentMethodLabel[payment.method],
          paidAtLabel: payment.paidAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hourCycle: "h23" }),
          reason: payment.reason,
          voided: payment.voidedAt != null,
          voidReason: payment.voidReason,
        })),
      });
      byCourse.set(enrollment.courseId, current);
    }
    if (byCourse.size === 0) {
      rows.push({
        rowKey: student.id,
        id: student.id,
        name: student.name,
        studentNo: student.studentNo,
        grade: student.grade,
        age: student.age,
        courseName: "还没有报名课程",
        hoursText: "—",
        validityText: "—",
        remainingHours: null,
        validUntil: null,
        paidAtTime: null,
        billingType: null,
        periodStatus: null,
        usageStatus: "未报名",
        lastPaid: "还没有缴费",
        enrolled: false,
        followUp: false,
        arrears: false,
        money: null,
        accounts: [],
        canDeactivate: false,
      });
      continue;
    }
    for (const [courseId, course] of byCourse) {
      const period = course.billingType === "PER_PERIOD" ? periodValidity(course.windows, today) : null;
      const remainingHours = course.billingType === "PER_LESSON" ? student.courseHourBalances.find((item) => item.courseId === courseId)?.remainingHours ?? 0 : null;
      const validUntil = period && period.end !== "—" ? period.end : null;
      const usage = {
        enrolled: true,
        billingType: course.billingType,
        periodStatus: period?.status ?? null,
        remainingHours,
        validUntil,
      };
      rows.push({
        rowKey: `${student.id}:${courseId}`,
        id: student.id,
        name: student.name,
        studentNo: student.studentNo,
        grade: student.grade,
        age: student.age,
        courseName: course.name,
        hoursText: remainingHours == null ? "—" : `剩余 ${remainingHours} 节`,
        validityText: period?.status === "未填写有效期" ? "未填写" : validUntil ? `至 ${validUntil}` : "—",
        remainingHours,
        validUntil,
        paidAtTime: course.paidAt ? course.paidAt.getTime() : null,
        billingType: course.billingType,
        periodStatus: period?.status ?? null,
        usageStatus: billingUsageLabel(usage, today),
        lastPaid: course.paidAt ? course.paidAt.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : "还没有缴费",
        enrolled: true,
        followUp: needsBillingFollowUp(usage, today),
        arrears: course.payableCents > course.netCents,
        money: {
          dueText: (course.dueCents / 100).toFixed(2),
          payableText: (course.payableCents / 100).toFixed(2),
          receivedText: (course.netCents / 100).toFixed(2),
          gapText: (Math.max(course.payableCents - course.netCents, 0) / 100).toFixed(2),
        },
        accounts: course.accounts,
        canDeactivate: canDeactivateEnrollment({
          billingType: course.billingType,
          remainingHours: remainingHours ?? 0,
          periodStatus: period?.status ?? null,
        }),
        courseId,
      });
    }
  }
  const renewalIds = [...new Set(rows.filter((row) => row.followUp).map((row) => row.id))];
  const pinRenewals = params.pin === "renewal" && renewalIds.length > 0;
  const renewalHref = renewalIds.length === 0 ? null : "/owner/billing?pin=renewal";
  const renewing = renewalIds.length;
  const visibleRows = rows.filter((row) => matchesBillingQuery(row, query) && matchesBillingFilter(row, statusFilter, today));
  const sortField = sort?.sortBy ?? null;
  const tableRows = sortField === "course"
    ? orderBillingRows(visibleRows, courses.map((course) => course.name))
    : sort && sortField
      ? [...visibleRows].sort((left, right) => compareBillingRows(left, right, sortField, sort.order, today))
      : statusFilter === "即将过期" || statusFilter === "已过期"
        ? [...visibleRows].sort((left, right) => compareBillingUrgency(left, right, today))
        : visibleRows;
  const orderedCourses = sort?.sortBy === "course" && sort.order === "desc" ? [...courses].reverse() : courses;
  const formCourses = orderedCourses.map((course) => ({
    id: course.id,
    name: course.name,
    billingType: course.billingType,
    classGroups: course.classGroups.map((item) => ({
      id: item.id,
      name: item.name,
      full: classIsFull(item.capacity, new Set(item.enrollments.map((row) => row.studentId)).size),
    })),
  }));
  const followUps = await prisma.renewalFollowUp.findMany({
    where: { organizationId: user.organizationId },
    orderBy: { createdAt: "desc" },
    select: { studentId: true, courseId: true, outcome: true, note: true, nextContactOn: true, createdBy: { select: { name: true } } },
  });
  const latestFollowUp = new Map<string, string>();
  for (const item of followUps) {
    const key = `${item.studentId}:${item.courseId}`;
    if (latestFollowUp.has(key)) continue;
    const next = item.nextContactOn ? item.nextContactOn.toISOString().slice(0, 10) : "";
    latestFollowUp.set(key, [renewalOutcomeLabel[item.outcome], item.note, next ? `下次 ${next}` : "", item.createdBy.name].filter(Boolean).join(" · "));
  }
  const listed = tableRows.map((row) => ({ ...row, latestFollowUp: latestFollowUp.get(row.rowKey) ?? null }));
  const pinned = pinRenewals
    ? [...listed.filter((row) => row.followUp), ...listed.filter((row) => !row.followUp)]
    : listed;
  const focusKey = params.focus?.trim() ?? "";
  const focused = focusKey ? pinned.find((row) => row.rowKey === focusKey) : null;
  const ordered = focused ? [focused, ...pinned.filter((row) => row.rowKey !== focusKey)] : pinned;
  const window = pageOf(params.page, ordered.length, billingPageSize);
  const exportQuery = new URLSearchParams();
  if (query) exportQuery.set("q", query);
  if (statusFilter) exportQuery.set("status", statusFilter);
  if (sort) {
    exportQuery.set("sortBy", sort.sortBy);
    exportQuery.set("order", sort.order);
  }
  function pageHref(page: number) {
    const next = new URLSearchParams(exportQuery);
    if (pinRenewals) next.set("pin", "renewal");
    if (focusKey) next.set("focus", focusKey);
    if (page > 1) next.set("page", String(page));
    const text = next.toString();
    return text ? `/owner/billing?${text}` : "/owner/billing";
  }

  return (
    <>
    <div className="mb-3 flex justify-end">
      <a href={`/owner/billing/export?${exportQuery}`} className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold text-[#385058]">导出当前结果</a>
    </div>
    <OwnerBilling
      courses={formCourses}
      query={query}
      statusFilter={statusFilter}
      sortBy={sort?.sortBy ?? null}
      order={sort?.order ?? null}
      stats={{ enrollments: thisMonth, compare, income: yuan(income._sum.amount), renewing, review }}
      renewalHref={renewalHref}
      pinRenewals={pinRenewals}
      focusKey={focusKey}
      students={ordered.slice(window.start, window.start + window.size)}
      directory={directory}
      prefill={params.enroll === "1" && params.studentId && params.courseId ? { studentId: params.studentId, courseId: params.courseId, lessonStudentId: params.lessonStudentId ?? "" } : null}
      openFormKey={params.form === "enroll" ? params.open ?? "1" : ""}
      openPanel={params.panel === "adjust" || params.panel === "pay" || params.panel === "follow" ? params.panel : ""}
      openRowKey={params.focus ?? ""}
      openStudentId={params.form === "enroll" ? params.who ?? "" : ""}
    />
    {window.pages > 1 ? (
      <div className="mt-3 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        <Pager page={window.page} pages={window.pages} href={pageHref} size={billingPageSize} />
      </div>
    ) : null}
    </>
  );
}
