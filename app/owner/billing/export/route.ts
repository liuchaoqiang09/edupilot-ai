import { CSV_EXPORT_MAX_ROWS, csvStreamResponse } from "@/lib/csv";
import { requireRole } from "@/lib/auth";
import { matchesBillingFilter, matchesBillingQuery, needsBillingFollowUp, type BillingQuickFilter } from "@/lib/billing-list";
import { calendarDateKey, periodValidity } from "@/lib/course-hours";
import { shanghaiDateKey } from "@/lib/datetime";
import { decimalCents, payableCents, paymentMethodLabel } from "@/lib/enrollment-money";
import { prisma } from "@/lib/prisma";

const batchSize = 400;

export async function GET(request: Request) {
  const user = await requireRole("OWNER", "owner");
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim() ?? "";
  const status = params.get("status");
  const statusFilter: BillingQuickFilter | "待续费" | "欠费" | null = status === "未报名" || status === "已过期" || status === "即将过期" || status === "待续费" || status === "欠费" ? status : null;
  const today = shanghaiDateKey();

  async function* rows() {
    let skip = 0;
    let exported = 0;
    while (exported < CSV_EXPORT_MAX_ROWS) {
      const batch = await prisma.payment.findMany({
        where: { organizationId: user.organizationId },
        orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
        skip,
        take: batchSize,
        select: {
          amount: true,
          method: true,
          paidAt: true,
          reason: true,
          voidedAt: true,
          createdBy: { select: { name: true } },
          enrollment: {
            select: {
              courseId: true,
              amountDue: true,
              discountPercent: true,
              amount: true,
              startDate: true,
              endDate: true,
              course: { select: { name: true, billingType: true } },
              student: {
                select: {
                  name: true,
                  studentNo: true,
                  courseHourBalances: { select: { courseId: true, remainingHours: true } },
                },
              },
            },
          },
        },
      });
      if (batch.length === 0) return;
      skip += batch.length;
      for (const payment of batch) {
        const enrollment = payment.enrollment;
        const due = decimalCents(enrollment.amountDue);
        const discount = enrollment.discountPercent == null ? null : Number(enrollment.discountPercent);
        const net = decimalCents(enrollment.amount);
        const windows = enrollment.startDate && enrollment.endDate
          ? [{ start: calendarDateKey(enrollment.startDate), end: calendarDateKey(enrollment.endDate) }]
          : [];
        const period = enrollment.course.billingType === "PER_PERIOD" ? periodValidity(windows, today) : null;
        const remainingHours = enrollment.course.billingType === "PER_LESSON"
          ? enrollment.student.courseHourBalances.find((item) => item.courseId === enrollment.courseId)?.remainingHours ?? 0
          : null;
        const validUntil = period && period.end !== "—" ? period.end : null;
        const usage = {
          enrolled: true,
          billingType: enrollment.course.billingType,
          periodStatus: period?.status ?? null,
          remainingHours,
          validUntil,
        };
        const row = {
          name: enrollment.student.name,
          studentNo: enrollment.student.studentNo,
          courseName: enrollment.course.name,
          enrolled: true,
          billingType: enrollment.course.billingType,
          remainingHours,
          validUntil,
          periodStatus: period?.status ?? null,
          followUp: needsBillingFollowUp(usage, today),
          arrears: payableCents(due, discount) > net,
          paidAtTime: payment.paidAt.getTime(),
        };
        if (!matchesBillingQuery(row, query) || !matchesBillingFilter(row, statusFilter, today)) continue;
        yield [
          enrollment.student.name,
          enrollment.student.studentNo,
          enrollment.course.name,
          payment.paidAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hourCycle: "h23" }),
          Number(payment.amount).toFixed(2),
          paymentMethodLabel[payment.method],
          payment.reason,
          payment.voidedAt ? "已作废" : "",
          payment.createdBy.name,
        ];
        exported += 1;
        if (exported >= CSV_EXPORT_MAX_ROWS) return;
      }
      if (batch.length < batchSize) return;
    }
  }

  return csvStreamResponse(
    "payments.csv",
    ["学生", "编号", "课程", "收款时间", "金额", "方式", "原因", "是否作废", "操作人"],
    rows(),
  );
}
