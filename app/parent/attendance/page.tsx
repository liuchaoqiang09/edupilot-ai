import { requireRole } from "@/lib/auth";
import { formatClock, formatDateLabel, shanghaiDateKey } from "@/lib/datetime";
import { attendanceLabel } from "@/lib/lesson-labels";
import { prisma } from "@/lib/prisma";

export default async function ParentAttendancePage() {
  const user = await requireRole("PARENT", "parent");
  const links = await prisma.parentStudentLink.findMany({
    where: { organizationId: user.organizationId, parentUserId: user.id },
    select: { studentId: true },
  });
  const rows = links.length
    ? await prisma.lessonStudent.findMany({
        where: {
          organizationId: user.organizationId,
          studentId: { in: links.map((link) => link.studentId) },
          lessonSession: { status: { not: "CANCELLED" } },
        },
        include: {
          student: { select: { name: true } },
          lessonSession: { include: { course: { select: { name: true } }, teacher: { select: { name: true } } } },
        },
        orderBy: { lessonSession: { startAt: "desc" } },
        take: 30,
      })
    : [];

  return (
    <section>
      <h1 className="text-[28px] font-semibold tracking-tight">出勤记录</h1>
      <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">这里只显示已绑定孩子在未取消课次里的出勤，状态由授课教师保存。</p>
      <div className="mt-6 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        {rows.length === 0 ? (
          <p className="px-5 py-12 text-center leading-7 text-[var(--muted)]">还没有出勤记录。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-xs">
              <thead className="bg-[#fafbf9] text-[10px] tracking-wide text-[#84918e]">
                <tr>
                  <th className="px-4 py-3 font-extrabold">日期</th>
                  <th className="px-4 py-3 font-extrabold">课次</th>
                  <th className="px-4 py-3 font-extrabold">孩子</th>
                  <th className="px-4 py-3 font-extrabold">教师</th>
                  <th className="px-4 py-3 font-extrabold">考勤状态</th>
                  <th className="px-4 py-3 font-extrabold">备注原因</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-[#eef1ee]">
                    <td className="px-4 py-4">{formatDateLabel(shanghaiDateKey(row.lessonSession.startAt))} {formatClock(row.lessonSession.startAt)}</td>
                    <td className="px-4 py-4 font-bold">{row.lessonSession.title ?? row.lessonSession.course.name}</td>
                    <td className="px-4 py-4">{row.student.name}</td>
                    <td className="px-4 py-4">{row.lessonSession.teacher.name}</td>
                    <td className={`px-4 py-4 ${row.attendanceStatus === "PRESENT" ? "font-bold text-[#34725d]" : row.attendanceStatus === "LEAVE" ? "font-bold text-[#c27b35]" : row.attendanceStatus === "ABSENT" ? "font-bold text-[#b94d4d]" : row.attendanceStatus === "LATE" ? "font-bold text-[#9a6729]" : ""}`}>{attendanceLabel[row.attendanceStatus]}</td>
                    <td className="px-4 py-4 text-[var(--muted)]">{row.attendanceNote?.trim() || "无备注"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
