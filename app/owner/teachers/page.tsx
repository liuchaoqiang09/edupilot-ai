import type { Prisma } from "@prisma/client";
import { TeacherDirectory } from "@/components/teacher-directory";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readSort } from "@/lib/table-sort";

const teacherSortFields = ["name", "contact"] as const;

export default async function TeachersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sortBy?: string | string[]; order?: string | string[] }>;
}) {
  const user = await requireRole("OWNER", "owner");
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const sort = readSort(params.sortBy, params.order, teacherSortFields);
  const orderBy: Prisma.TeacherOrderByWithRelationInput[] = !sort
    ? [{ status: "asc" }, { createdAt: "desc" }]
    : sort.sortBy === "name"
      ? [{ name: sort.order }, { createdAt: "desc" }]
      : [{ contact: sort.order }, { name: "asc" }];

  const teachers = await prisma.teacher.findMany({
    where: {
      organizationId: user.organizationId,
      ...(query ? { name: { contains: query, mode: "insensitive" } } : {}),
    },
    include: {
      user: { select: { email: true } },
      accountUser: { select: { email: true } },
    },
    orderBy,
  });

  return (
    <TeacherDirectory
      query={query}
      sortBy={sort?.sortBy ?? null}
      order={sort?.order ?? null}
      teachers={teachers.map((teacher) => ({
        id: teacher.id,
        name: teacher.name,
        contact: teacher.contact,
        status: teacher.status,
        linked: Boolean(teacher.userId),
        accountEmail: teacher.accountUser?.email ?? teacher.user?.email ?? null,
      }))}
    />
  );
}
