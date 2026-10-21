import { TeacherDirectory } from "@/components/teacher-directory";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function TeachersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requireRole("OWNER", "owner");
  const params = await searchParams;
  const query = params.q?.trim() ?? "";

  const [teachers, accounts, links] = await Promise.all([
    prisma.teacher.findMany({
      where: {
        organizationId: user.organizationId,
        ...(query ? { name: { contains: query, mode: "insensitive" } } : {}),
      },
      include: { user: { select: { name: true } } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
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
