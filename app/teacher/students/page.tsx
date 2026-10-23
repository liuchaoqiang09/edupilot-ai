import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { studentFacts, studyBadge } from "@/lib/student-profile";

export default async function TeacherStudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requireRole("TEACHER", "teacher");
  const params = await searchParams;
  const showInactive = params.status === "含已停用";
  const teacher = await prisma.teacher.findFirst({
    where: { userId: user.id, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  const rows = teacher
    ? await prisma.lessonStudent.findMany({
        where: { organizationId: user.organizationId, lessonSession: { teacherId: teacher.id } },
        select: { student: { select: { id: true, name: true, grade: true, age: true, studentNo: true, status: true, archiveReason: true, _count: { select: { enrollments: true } } } } },
      })
    : [];
  const students = [...new Map(rows.map((row) => [row.student.id, row.student])).values()]
    .filter((student) => showInactive || student.status === "ACTIVE")
    .sort((left, right) => left.name.localeCompare(right.name));

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">我的学生</h1>
          <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">只显示出现在你课次名单里的学生。默认不显示已停用的学生。</p>
        </div>
        <Link href={showInactive ? "/teacher/students" : "/teacher/students?status=含已停用"} className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold text-[#385058]">
          {showInactive ? "只看在读" : "显示已停用"}
        </Link>
      </div>
      {showInactive ? <p className="mt-4 text-xs font-bold text-[#74838b]">当前正在筛选：包含已停用学生</p> : null}
      <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        {!teacher ? (
          <p className="px-5 py-12 text-center text-sm leading-7 text-[var(--muted)]">当前账号还没有关联在职教师档案。</p>
        ) : students.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm leading-7 text-[var(--muted)]">{showInactive ? "还没有出现在你课次里的学生。" : "目前没有在读学生。可以打开「显示已停用」查看已经停用的学生。"}</p>
        ) : (
          <ul>
            {students.map((student) => (
              <li key={student.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eef1ee] px-5 py-4 last:border-b-0">
                <div>
                  <div className="text-sm font-bold">{student.name}</div>
                  <div className="mt-1 text-xs text-[var(--muted)]">{studentFacts(student.grade, student.age)} · {student.studentNo ?? "无编号"}</div>
                </div>
                {student.status === "INACTIVE" ? (
                  <div className="text-right">
                    <span className="rounded-full bg-[#eef1ee] px-2 py-1 text-[10px] font-bold text-[#74838b]">已停用</span>
                    <div className="mt-1 text-xs text-[#74838b]">停用原因：{student.archiveReason?.trim() || "未填写"}</div>
                  </div>
                ) : (
                  <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${studyBadge(student.status, student._count.enrollments > 0).className}`}>
                    {studyBadge(student.status, student._count.enrollments > 0).label}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
