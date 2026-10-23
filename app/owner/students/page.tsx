import type { Prisma } from "@prisma/client";
import { StudentDirectory } from "@/components/student-directory";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readSort } from "@/lib/table-sort";

const studentSortFields = ["name", "studentNo"] as const;

function enrollmentLabels(enrollments: { course: { name: string }; classGroup: { name: string } | null }[]) {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const enrollment of enrollments) {
    const label = enrollment.classGroup ? `${enrollment.course.name} · ${enrollment.classGroup.name}` : enrollment.course.name;
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; sortBy?: string | string[]; order?: string | string[] }>;
}) {
  const user = await requireRole("OWNER", "owner");
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const statusFilter = params.status === "在读" || params.status === "已停用" ? params.status : null;
  const sort = readSort(params.sortBy, params.order, studentSortFields);
  const orderBy: Prisma.StudentOrderByWithRelationInput[] = sort
    ? [{ [sort.sortBy]: sort.order }, { createdAt: "desc" }]
    : [{ status: "asc" }, { createdAt: "desc" }];

  const [students, parents, links] = await Promise.all([
    prisma.student.findMany({
      where: {
        organizationId: user.organizationId,
        ...(statusFilter === "已停用" ? { status: "INACTIVE" as const } : {}),
        ...(statusFilter === "在读" ? { status: "ACTIVE" as const, enrollments: { some: {} } } : {}),
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                { studentNo: { contains: query, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy,
      include: {
        enrollments: {
          orderBy: { createdAt: "desc" },
          select: {
            course: { select: { name: true } },
            classGroup: { select: { name: true } },
          },
        },
      },
    }),
    prisma.user.findMany({
      where: { organizationId: user.organizationId, roles: { has: "PARENT" } },
      select: { id: true, name: true, email: true, phone: true },
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
      statusFilter={statusFilter}
      sortBy={sort?.sortBy ?? null}
      order={sort?.order ?? null}
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
        age: student.age,
        guardianName: student.guardianName,
        contactNote: student.contactNote,
        status: student.status,
        archiveReason: student.archiveReason,
        courses: enrollmentLabels(student.enrollments),
      }))}
    />
  );
}
