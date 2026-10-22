import type { Prisma } from "@prisma/client";
import { TeacherDirectory } from "@/components/teacher-directory";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readSort } from "@/lib/table-sort";

const teacherSortFields = ["name", "phone"] as const;

export default async function TeachersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; sortBy?: string | string[]; order?: string | string[] }>;
}) {
  const user = await requireRole("OWNER", "owner");
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const statusFilter = params.status === "在职" ? "在职" : null;
  const sort = readSort(params.sortBy, params.order, teacherSortFields);
  const orderBy: Prisma.TeacherOrderByWithRelationInput[] = !sort
    ? [{ status: "asc" }, { createdAt: "desc" }]
    : sort.sortBy === "name"
      ? [{ name: sort.order }, { createdAt: "desc" }]
      : [{ phone: sort.order }, { name: "asc" }];

  const courses = await prisma.course.findMany({
    where: { organizationId: user.organizationId },
    select: { id: true, name: true, status: true },
    orderBy: { name: "asc" },
  });
  const teachers = await prisma.teacher.findMany({
    where: {
      organizationId: user.organizationId,
      ...(statusFilter ? { status: "ACTIVE" as const } : {}),
      ...(query ? { name: { contains: query, mode: "insensitive" } } : {}),
    },
    include: {
      user: { select: { email: true } },
      accountUser: { select: { email: true } },
      courses: { include: { course: { select: { id: true, name: true } } }, orderBy: { course: { name: "asc" } } },
    },
    orderBy,
  });

  return (
    <TeacherDirectory
      query={query}
      statusFilter={statusFilter}
      sortBy={sort?.sortBy ?? null}
      order={sort?.order ?? null}
      courses={courses}
      teachers={teachers.map((teacher) => ({
        id: teacher.id,
        name: teacher.name,
        phone: teacher.phone,
        wechat: teacher.wechat,
        courseIds: teacher.courses.map((row) => row.course.id),
        courseNames: teacher.courses.map((row) => row.course.name),
        status: teacher.status,
        linked: Boolean(teacher.userId),
        accountEmail: teacher.accountUser?.email ?? teacher.user?.email ?? null,
      }))}
    />
  );
}
