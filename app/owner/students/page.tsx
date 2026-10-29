import type { Prisma } from "@prisma/client";
import { Pager, pageOf } from "@/components/pager";
import { StudentDirectory } from "@/components/student-directory";
import { billingStatusRank, shiftDateKey } from "@/lib/billing-list";
import { calendarDateKey, periodValidity } from "@/lib/course-hours";
import { requireRole } from "@/lib/auth";
import { shanghaiDateKey } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { unenrolledBadgeClass } from "@/lib/student-profile";
import { readSort } from "@/lib/table-sort";

const studentSortFields = ["name", "studentNo", "status"] as const;

const activeBadge = "bg-[#edf5f1] text-[#34725d]";
const attentionBadge = "bg-[#fff2df] text-[#9a6729]";

function listStanding(
  student: {
    status: "ACTIVE" | "INACTIVE";
    enrollments: { courseId: string; startDate: Date | null; endDate: Date | null; course: { billingType: "PER_LESSON" | "PER_PERIOD" } }[];
    courseHourBalances: { courseId: string; remainingHours: number }[];
  },
  today: string,
) {
  if (student.status !== "ACTIVE") return { label: "已停用", className: attentionBadge, rank: 5 };
  if (student.enrollments.length === 0) return { label: "未报名", className: unenrolledBadgeClass, rank: 0 };
  const byCourse = new Map<string, { billingType: "PER_LESSON" | "PER_PERIOD"; windows: { start: string; end: string }[] }>();
  for (const enrollment of student.enrollments) {
    const current = byCourse.get(enrollment.courseId) ?? { billingType: enrollment.course.billingType, windows: [] };
    if (enrollment.startDate && enrollment.endDate) {
      current.windows.push({ start: calendarDateKey(enrollment.startDate), end: calendarDateKey(enrollment.endDate) });
    }
    byCourse.set(enrollment.courseId, current);
  }
  let expiredOn: string | null = null;
  let zeroHours = false;
  let lowestRemaining: number | null = null;
  let expiringSoon = false;
  for (const [courseId, course] of byCourse) {
    const period = course.billingType === "PER_PERIOD" ? periodValidity(course.windows, today) : null;
    const remainingHours = course.billingType === "PER_LESSON" ? student.courseHourBalances.find((item) => item.courseId === courseId)?.remainingHours ?? 0 : null;
    const validUntil = period && period.end !== "—" ? period.end : null;
    const courseRank = billingStatusRank({
      enrolled: true,
      billingType: course.billingType,
      remainingHours,
      validUntil,
      periodStatus: period?.status ?? null,
    }, today);
    const low = remainingHours != null && remainingHours > 0 && remainingHours <= 5;
    if (courseRank === 1 && validUntil && (expiredOn == null || validUntil > expiredOn)) expiredOn = validUntil;
    if (courseRank === 2) zeroHours = true;
    if (low) lowestRemaining = lowestRemaining == null || remainingHours < lowestRemaining ? remainingHours : lowestRemaining;
    if (period?.status === "有效中" && validUntil != null && validUntil <= shiftDateKey(today, 7)) expiringSoon = true;
  }
  if (expiredOn) return { label: `已过期 ${expiredOn}`, className: attentionBadge, rank: 1 };
  if (zeroHours) return { label: "无课时", className: attentionBadge, rank: 2 };
  if (lowestRemaining != null) return { label: `课时不足 剩余 ${lowestRemaining} 课时`, className: attentionBadge, rank: 3 };
  if (expiringSoon) return { label: "快过期", className: attentionBadge, rank: 4 };
  return { label: "在读", className: activeBadge, rank: 5 };
}

function compareListStatus(leftRank: number, rightRank: number, order: "asc" | "desc") {
  const leftNormal = leftRank >= 5;
  const rightNormal = rightRank >= 5;
  if (leftNormal !== rightNormal) return leftNormal ? 1 : -1;
  if (leftRank === rightRank) return 0;
  const diff = leftRank - rightRank;
  return order === "asc" ? diff : -diff;
}

function enrollmentLabels(enrollments: { course: { name: string }; classGroup: { name: string } | null }[]) {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const enrollment of enrollments) {
    const label = enrollment.classGroup ? `${enrollment.course.name} · ${enrollment.classGroup.name}` : enrollment.course.name;
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; create?: string; sortBy?: string | string[]; order?: string | string[]; page?: string; student?: string; open?: string; form?: string }>;
}) {
  const user = await requireRole("OWNER", "owner");
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const openCreate = params.create === "1";
  const statusFilter = params.status === "在读" || params.status === "已停用" ? params.status : null;
  const sort = readSort(params.sortBy, params.order, studentSortFields);
  const orderBy: Prisma.StudentOrderByWithRelationInput[] = sort && sort.sortBy !== "status"
    ? [{ [sort.sortBy]: sort.order }, { createdAt: "desc" }]
    : [{ status: "asc" }, { createdAt: "desc" }];

  const [students, parents, hourAdjustments, links] = await Promise.all([
    prisma.student.findMany({
      where: {
        organizationId: user.organizationId,
        ...(statusFilter === "已停用" ? { status: "INACTIVE" as const } : {}),
        ...(statusFilter === "在读" ? { status: "ACTIVE" as const, enrollments: { some: {} } } : {}),
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                { studentNo: { contains: query, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy,
      include: {
        enrollments: {
          orderBy: { createdAt: "desc" },
          select: {
            courseId: true,
            startDate: true,
            endDate: true,
            course: { select: { name: true, billingType: true } },
            classGroup: { select: { name: true } },
          },
        },
        courseHourBalances: { select: { courseId: true, remainingHours: true } },
      },
    }),
    prisma.user.findMany({
      where: { organizationId: user.organizationId, roles: { has: "PARENT" } },
      select: { id: true, name: true, email: true, phone: true },
      orderBy: { name: "asc" },
    }),
    prisma.hourAdjustment.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        studentId: true,
        deltaHours: true,
        reason: true,
        createdAt: true,
        course: { select: { name: true } },
        createdBy: { select: { name: true } },
      },
    }),
    prisma.parentStudentLink.findMany({
      where: { organizationId: user.organizationId },
      include: { parent: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const adjustments = new Map<string, { id: string; courseName: string; deltaHours: number; reason: string; actorName: string; at: string }[]>();
  for (const item of hourAdjustments) {
    const list = adjustments.get(item.studentId) ?? [];
    list.push({
      id: item.id,
      courseName: item.course.name,
      deltaHours: item.deltaHours,
      reason: item.reason,
      actorName: item.createdBy.name,
      at: item.createdAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hourCycle: "h23" }),
    });
    adjustments.set(item.studentId, list);
  }
  const today = shanghaiDateKey();
  const rows = students.map((student) => {
    const standing = listStanding(student, today);
    return {
      id: student.id,
      name: student.name,
      studentNo: student.studentNo,
      grade: student.grade,
      age: student.age,
      guardianName: student.guardianName,
      guardianPhone: student.guardianPhone,
      contactNote: student.contactNote,
      status: student.status,
      archiveReason: student.archiveReason,
      courses: enrollmentLabels(student.enrollments),
      studyLabel: standing.label,
      studyClassName: standing.className,
      statusRank: standing.rank,
      hourAdjustments: adjustments.get(student.id) ?? [],
    };
  });
  if (sort?.sortBy === "status") {
    rows.sort((left, right) => compareListStatus(left.statusRank, right.statusRank, sort.order)
      || left.name.localeCompare(right.name, "zh-CN")
      || (left.studentNo ?? "\uffff").localeCompare(right.studentNo ?? "\uffff", "zh-CN"));
  }

  const listed = rows.map(({ statusRank: _statusRank, ...student }) => student);
  const window = pageOf(params.page, listed.length);
  const pageRows = listed.slice(window.start, window.start + 20);
  const focused = params.student ? listed.find((student) => student.id === params.student) : null;
  const visible = focused && !pageRows.some((student) => student.id === focused.id) ? [focused, ...pageRows] : pageRows;
  function pageHref(page: number) {
    const next = new URLSearchParams();
    if (query) next.set("q", query);
    if (statusFilter) next.set("status", statusFilter);
    if (sort) {
      next.set("sortBy", sort.sortBy);
      next.set("order", sort.order);
    }
    if (page > 1) next.set("page", String(page));
    const text = next.toString();
    return text ? `/owner/students?${text}` : "/owner/students";
  }

  return (
    <>
    <StudentDirectory
      query={query}
      focusId={params.student ?? null}
      openCreate={openCreate}
      launchKey={openCreate ? params.open ?? "1" : ""}
      importKey={params.form === "import" ? params.open ?? "1" : ""}
      statusFilter={statusFilter}
      sortBy={sort?.sortBy ?? null}
      order={sort?.order ?? null}
      parents={parents}
      links={links.map((link) => ({
        id: link.id,
        studentId: link.studentId,
        parentUserId: link.parentUserId,
        parentName: link.parent.name,
        parentEmail: link.parent.email,
      }))}
      students={visible}
    />
    {window.pages > 1 ? (
      <div className="mt-3 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        <Pager page={window.page} pages={window.pages} href={pageHref} />
      </div>
    ) : null}
    </>
  );
}
