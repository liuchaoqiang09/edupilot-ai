import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { decimalCents, paymentMethodLabel } from "@/lib/enrollment-money";
import { pick } from "@/lib/locale";
import { prisma } from "@/lib/prisma";
import { PrintButton } from "@/components/print-button";

export default async function PaymentReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("OWNER", "owner");
  const { id } = await params;
  const payment = await prisma.payment.findFirst({
    where: { id, organizationId: user.organizationId },
    select: {
      amount: true,
      method: true,
      paidAt: true,
      reason: true,
      voidedAt: true,
      voidReason: true,
      createdBy: { select: { name: true } },
      enrollment: {
        select: {
          amountDue: true,
          amount: true,
          student: { select: { name: true, studentNo: true } },
          course: { select: { name: true } },
          classGroup: { select: { name: true } },
        },
      },
    },
  });
  if (!payment) notFound();
  const t = (zh: string, en: string) => pick(user.locale, zh, en);
  const cents = decimalCents(payment.amount);
  const title = cents < 0 ? t("退费收据", "Refund receipt") : t("收款收据", "Payment receipt");

  return (
    <section className="mx-auto max-w-xl">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/owner/billing" className="text-xs font-bold text-[var(--teal)]">{t("返回报名与课时", "Back to enrollment")}</Link>
        <PrintButton label={t("打印", "Print")} />
      </div>
      <article className="rounded-2xl border border-[var(--line)] bg-white px-8 py-8">
        <p className="text-xs text-[var(--muted)]">{user.organizationName}</p>
        <h1 className="mt-2 text-2xl font-semibold">{title}</h1>
        {payment.voidedAt ? <p className="mt-3 text-sm font-bold text-[#9a6729]">{t("这笔流水已作废，不计入实收。", "This payment is void and is not counted.")}{payment.voidReason ? ` ${payment.voidReason}` : ""}</p> : null}
        <dl className="mt-6 grid gap-3 text-sm">
          <Row label={t("学生", "Student")} value={`${payment.enrollment.student.name}${payment.enrollment.student.studentNo ? ` · ${payment.enrollment.student.studentNo}` : ""}`} />
          <Row label={t("课程", "Course")} value={payment.enrollment.classGroup ? `${payment.enrollment.course.name} · ${payment.enrollment.classGroup.name}` : payment.enrollment.course.name} />
          <Row label={t("金额", "Amount")} value={`${cents < 0 ? "-" : ""}¥ ${(Math.abs(cents) / 100).toFixed(2)}`} />
          <Row label={t("方式", "Method")} value={paymentMethodLabel[payment.method]} />
          <Row label={t("时间", "Time")} value={payment.paidAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hourCycle: "h23" })} />
          <Row label={t("操作人", "Recorded by")} value={payment.createdBy.name} />
          {payment.reason ? <Row label={t("说明", "Note")} value={payment.reason} /> : null}
          <Row label={t("这次报名应收", "Amount due")} value={`¥ ${Number(payment.enrollment.amountDue).toFixed(2)}`} />
          <Row label={t("这次报名未作废实收", "Received")} value={`¥ ${Number(payment.enrollment.amount).toFixed(2)}`} />
        </dl>
      </article>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 border-b border-[#eef1ee] py-2">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
