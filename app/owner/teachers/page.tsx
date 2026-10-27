import type { Prisma } from "@prisma/client";
import { TeacherDirectory } from "@/components/teacher-directory";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readSort } from "@/lib/table-sort";

const teacherSortFields = ["name", "phone", "teacherNo"] as const;

export default async function TeachersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; sortBy?: string | string[]; order?: string | string[]; form?: string; open?: string; teacher?: string }>;
}) {
  const user = await requireRole("OWNER", "owner");
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const statusFilter = params.status === "在职" || params.status === "已停用" ? params.status : null;
  const sort = readSort(params.sortBy, params.order, teacherSortFields);
  const orderBy: Prisma.TeacherOrderByWithRelationInput[] = !sort
    ? [{ status: "asc" }, { createdAt: "desc" }]
    : sort.sortBy === "name"
      ? [{ name: sort.order }, { createdAt: "desc" }]
      : sort.sortBy === "teacherNo"
        ? [{ teacherNo: { sort: sort.order, nulls: "last" } }, { name: "asc" }]
        : [{ phone: sort.order }, { name: "asc" }];

  const courses = await prisma.course.findMany({
    where: { organizationId: user.organizationId },
    select: { id: true, name: true, status: true },
    orderBy: { name: "asc" },
  });
  const [teachers, upcoming] = await Promise.all([
    prisma.teacher.findMany({
      where: {
        organizationId: user.organizationId,
        ...(statusFilter === "在职" ? { status: "ACTIVE" as const } : {}),
        ...(statusFilter === "已停用" ? { status: "INACTIVE" as const } : {}),
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                { teacherNo: { contains: query, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: {
        user: { select: { email: true } },
        accountUser: { select: { email: true } },
        courses: { include: { course: { select: { id: true, name: true } } }, orderBy: { course: { name: "asc" } } },
      },
      orderBy,
    }),
    prisma.lessonSession.groupBy({
      by: ["teacherId"],
      where: { organizationId: user.organizationId, status: { not: "CANCELLED" }, startAt: { gt: new Date() } },
      _count: { _all: true },
    }),
  ]);
  const upcomingByTeacher = new Map(upcoming.map((row) => [row.teacherId, row._count._all]));

  return (
    <TeacherDirectory
      query={query}
      statusFilter={statusFilter}
      sortBy={sort?.sortBy ?? null}
      order={sort?.order ?? null}
      openFormKey={params.form === "create" ? params.open ?? "1" : ""}
      focusId={params.teacher ?? ""}
      courses={courses}
      teachers={teachers.map((teacher) => ({
        id: teacher.id,
        name: teacher.name,
        teacherNo: teacher.teacherNo,
        phone: teacher.phone,
        wechat: teacher.wechat,
        courseIds: teacher.courses.map((row) => row.course.id),
        courseNames: teacher.courses.map((row) => row.course.name),
        status: teacher.status,
        linked: Boolean(teacher.userId),
        accountEmail: teacher.accountUser?.email ?? teacher.user?.email ?? null,
        upcomingLessonCount: upcomingByTeacher.get(teacher.id) ?? 0,
      }))}
    />
  );
}
