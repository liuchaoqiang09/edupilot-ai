import Link from "next/link";
import { DateField } from "@/components/date-field";
import { ParentChildFilter } from "@/components/parent-child-filter";
import { ParentTimeOrder, parseTimeOrder } from "@/components/parent-time-order";
import { requireRole } from "@/lib/auth";
import { dayRange, formatDateLabel, shanghaiDateKey, shiftDate } from "@/lib/datetime";
import { paymentMethodLabel } from "@/lib/enrollment-money";
import { formatYuan, parentCourseCards } from "@/lib/parent-courses";
import { linkedParentChildren, pickLinkedChildId } from "@/lib/parent-scope";
import { prisma } from "@/lib/prisma";

function calendarDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value : "";
}

/** 家长端用语：机构记「收款」，家长侧显示「付款」。 */
function parentPaymentNote(reason: string | null | undefined, refund: boolean) {
  const note = reason?.trim();
  if (!note || note === "收款") return refund ? "退费" : "付款";
  return note;
}

export default async function ParentCoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string; from?: string; to?: string; order?: string }>;
}) {
  const user = await requireRole("PARENT", "parent");
  const params = await searchParams;
  const children = await linkedParentChildren(user.organizationId, user.id);
  const studentId = pickLinkedChildId(children, params.student);
  const order = parseTimeOrder(params.order);
  const from = calendarDate(params.from);
  const to = calendarDate(params.to);
  const invalidRange = Boolean(from && to && from > to);
  const studentIds = studentId ? [studentId] : children.map((child) => child.id);
  const allCards = await parentCourseCards(user.organizationId, user.id);
  const cards = studentId ? allCards.filter((card) => card.key.startsWith(`${studentId}:`)) : allCards;

  const paidWindow =
    !invalidRange && studentIds.length > 0
      ? {
          ...(from ? { gte: dayRange(from).start } : {}),
          ...(to ? { lt: dayRange(shiftDate(to, 1)).start } : {}),
        }
      : null;
  const payments =
    !invalidRange && studentIds.length > 0
      ? await prisma.payment.findMany({
          where: {
            organizationId: user.organizationId,
            voidedAt: null,
            enrollment: {
              studentId: { in: studentIds },
              student: { parentLinks: { some: { organizationId: user.organizationId, parentUserId: user.id } } },
            },
            ...(paidWindow && Object.keys(paidWindow).length > 0 ? { paidAt: paidWindow } : {}),
          },
          orderBy: { paidAt: order },
          take: 100,
          select: {
            id: true,
            amount: true,
            method: true,
            paidAt: true,
            reason: true,
            enrollment: {
              select: {
                student: { select: { name: true } },
                course: { select: { name: true } },
              },
            },
          },
        })
      : [];

  return (
    <section>
      <h1 className="text-[28px] font-semibold tracking-tight">课时与费用</h1>
      <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">只显示已绑定孩子报名过的课程，以及还没有报名、但已经排进课表的课程。按课时显示剩余节数，按周期显示有效期。待缴是折后应缴减去未作废的实收。下方流水含付款与退费，不作废记录不展示。</p>
      <ParentChildFilter
        basePath="/parent/courses"
        childrenList={children}
        selectedId={studentId}
        extraParams={{
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
          ...(order === "asc" ? { order: "asc" } : {}),
        }}
      />
      {cards.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-[var(--line)] bg-white px-5 py-12 text-center leading-7 text-[var(--muted)]">还没有报名记录。机构完成报名后，课时和费用会出现在这里。</p>
      ) : (
        <ul className="mt-4 grid gap-3">
          {cards.map((card) => (
            <li key={card.key} className="rounded-2xl border border-[var(--line)] bg-white px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-bold">{card.studentName} · {card.courseName}</div>
                  <div className="mt-1 text-xs text-[var(--muted)]">{card.usage}{card.inactive ? " · 孩子已停用" : ""}</div>
                </div>
                <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${!card.enrolled || card.arrearsCents > 0 ? "bg-[#fff2df] text-[#9a6729]" : "bg-[#edf5f1] text-[#34725d]"}`}>
                  {!card.enrolled ? "还没有报名记录" : card.arrearsCents > 0 ? `待缴 ${formatYuan(card.arrearsCents)} 元` : "费用已结清"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">缴费与退费流水</h2>
            <p className="mt-1 text-xs leading-6 text-[var(--muted)]">只显示已绑定孩子、未作废的流水。可按日期筛选；退费金额为负数。</p>
          </div>
          <ParentTimeOrder
            basePath="/parent/courses"
            order={order}
            extraParams={{
              ...(studentId ? { student: studentId } : {}),
              ...(from ? { from } : {}),
              ...(to ? { to } : {}),
            }}
          />
        </div>
        <form action="/parent/courses" className="mt-3 flex flex-wrap items-center gap-2">
          {studentId ? <input type="hidden" name="student" value={studentId} /> : null}
          {order === "asc" ? <input type="hidden" name="order" value="asc" /> : null}
          <DateField name="from" defaultValue={from} className="w-36 rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold" />
          <span className="text-xs text-[var(--muted)]">至</span>
          <DateField name="to" defaultValue={to} className="w-36 rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold" />
          <button className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold">查看流水</button>
          {from || to || studentId || order === "asc" ? <Link href="/parent/courses" className="text-xs font-bold text-[var(--teal)]">重置</Link> : null}
        </form>
        <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
          {invalidRange ? (
            <p className="px-5 py-12 text-center leading-7 text-[var(--muted)]">开始日期不能晚于结束日期。</p>
          ) : payments.length === 0 ? (
            <p className="px-5 py-12 text-center leading-7 text-[var(--muted)]">{children.length === 0 ? "还没有绑定孩子，因此没有流水。" : from || to ? "这个时间里没有缴费或退费记录。" : "还没有缴费或退费记录。"}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left text-xs">
                <thead className="bg-[#fafbf9] text-[10px] tracking-wide text-[#84918e]">
                  <tr>
                    <th className="px-4 py-3 font-extrabold">日期</th>
                    <th className="px-4 py-3 font-extrabold">孩子</th>
                    <th className="px-4 py-3 font-extrabold">课程</th>
                    <th className="px-4 py-3 font-extrabold">方式</th>
                    <th className="px-4 py-3 font-extrabold">金额（元）</th>
                    <th className="px-4 py-3 font-extrabold">说明</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((row) => {
                    const cents = Math.round(Number(row.amount) * 100);
                    const refund = cents < 0;
                    return (
                      <tr key={row.id} className="border-t border-[#eef1ee]">
                        <td className="px-4 py-4">{formatDateLabel(shanghaiDateKey(row.paidAt))}</td>
                        <td className="px-4 py-4 font-bold">{row.enrollment.student.name}</td>
                        <td className="px-4 py-4">{row.enrollment.course.name}</td>
                        <td className="px-4 py-4">{paymentMethodLabel[row.method]}</td>
                        <td className={`px-4 py-4 font-bold ${refund ? "text-[#b94d4d]" : "text-[#34725d]"}`}>
                          {refund ? "退费 " : "付款 "}
                          {formatYuan(Math.abs(cents))}
                        </td>
                        <td className="px-4 py-4 text-[var(--muted)]">{parentPaymentNote(row.reason, refund)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
