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

  const [teachers, accounts, links] = await Promise.all([
    prisma.teacher.findMany({
      where: {
        organizationId: user.organizationId,
        ...(query ? { name: { contains: query, mode: "insensitive" } } : {}),
      },
      include: { user: { select: { name: true } } },
      orderBy,
    }),
    prisma.user.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    prisma.teacher.findMany({
      where: { organizationId: user.organizationId, userId: { not: null } },
      select: { id: true, userId: true },
    }),
  ]);

  return (
    <TeacherDirectory
      query={query}
      sortBy={sort?.sortBy ?? null}
      order={sort?.order ?? null}
      accounts={accounts}
      links={links.flatMap((link) => (link.userId ? [{ teacherId: link.id, userId: link.userId }] : []))}
      teachers={teachers.map((teacher) => ({
        id: teacher.id,
        name: teacher.name,
        contact: teacher.contact,
        status: teacher.status,
        userId: teacher.userId,
        accountName: teacher.user?.name ?? null,
      }))}
    />
  );
}
