import { CSV_EXPORT_MAX_ROWS, csvStreamResponse } from "@/lib/csv";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readSort } from "@/lib/table-sort";

const studentSortFields = ["name", "studentNo", "status"] as const;
const batchSize = 400;

export async function GET(request: Request) {
  const user = await requireRole("OWNER", "owner");
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim() ?? "";
  const status = params.get("status");
  const sort = readSort(params.get("sortBy") ?? undefined, params.get("order") ?? undefined, studentSortFields);
  const where = {
    organizationId: user.organizationId,
    ...(status === "已停用" ? { status: "INACTIVE" as const } : {}),
    ...(status === "在读" ? { status: "ACTIVE" as const, enrollments: { some: {} } } : {}),
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" as const } },
            { studentNo: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const orderBy = sort && sort.sortBy !== "status"
    ? [{ [sort.sortBy]: sort.order }, { createdAt: "desc" as const }]
    : [{ status: "asc" as const }, { name: "asc" as const }];

  async function* rows() {
    let skip = 0;
    let exported = 0;
    while (exported < CSV_EXPORT_MAX_ROWS) {
      const batch = await prisma.student.findMany({
        where,
        orderBy,
        skip,
        take: batchSize,
        select: {
          name: true,
          studentNo: true,
          grade: true,
          age: true,
          guardianName: true,
          guardianPhone: true,
          status: true,
          enrollments: { select: { course: { select: { name: true } }, classGroup: { select: { name: true } } } },
        },
      });
      if (batch.length === 0) return;
      skip += batch.length;
      for (const student of batch) {
        const courses = [...new Set(student.enrollments.map((item) => (item.classGroup ? `${item.course.name} · ${item.classGroup.name}` : item.course.name)))];
        yield [
          student.name,
          student.studentNo,
          student.grade,
          student.age,
          student.guardianName,
          student.guardianPhone,
          student.status === "ACTIVE" ? "在读" : "已停用",
          courses.join("、"),
        ];
        exported += 1;
        if (exported >= CSV_EXPORT_MAX_ROWS) return;
      }
      if (batch.length < batchSize) return;
    }
  }

  return csvStreamResponse("students.csv", ["姓名", "编号", "年级", "年龄", "联系人", "联系人电话", "状态", "报名课程"], rows());
}
