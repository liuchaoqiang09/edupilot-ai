import { StudentDirectory } from "@/components/student-directory";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requireRole("OWNER", "owner");
  const params = await searchParams;
  const query = params.q?.trim() ?? "";

  const [students, parents, links] = await Promise.all([
    prisma.student.findMany({
      where: {
        organizationId: user.organizationId,
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                { studentNo: { contains: query, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    }),
    prisma.user.findMany({
      where: { organizationId: user.organizationId, roles: { has: "PARENT" } },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    prisma.parentStudentLink.findMany({
      where: { organizationId: user.organizationId },
      include: { parent: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <StudentDirectory
      query={query}
      parents={parents}
      links={links.map((link) => ({
        id: link.id,
        studentId: link.studentId,
        parentUserId: link.parentUserId,
        parentName: link.parent.name,
        parentEmail: link.parent.email,
      }))}
      students={students.map((student) => ({
        id: student.id,
        name: student.name,
        studentNo: student.studentNo,
        grade: student.grade,
        contactNote: student.contactNote,
        status: student.status,
      }))}
    />
  );
}
