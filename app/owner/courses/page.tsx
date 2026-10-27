import { CourseDirectory } from "@/components/course-directory";
import { requireRole } from "@/lib/auth";
import { classIsFull, distinctEnrolled } from "@/lib/class-occupancy";
import { formatDateTime } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";

export default async function CoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ class?: string; form?: string; open?: string }>;
}) {
  const user = await requireRole("OWNER", "owner");
  const params = await searchParams;

  const [courses, classes, teachers, enrollments, waitlist, students] = await Promise.all([
    prisma.course.findMany({
      where: { organizationId: user.organizationId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    }),
    prisma.classGroup.findMany({
      where: { organizationId: user.organizationId },
      include: {
        course: { select: { id: true, name: true } },
        teacher: { select: { id: true, name: true } },
        _count: { select: { lessonSessions: true } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    }),
    prisma.teacher.findMany({
      where: { organizationId: user.organizationId, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.enrollment.findMany({
      where: { organizationId: user.organizationId, classGroupId: { not: null }, student: { status: "ACTIVE" } },
      select: { classGroupId: true, studentId: true },
    }),
    prisma.classWaitlist.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { createdAt: "asc" },
      select: { id: true, classGroupId: true, studentId: true, createdAt: true, student: { select: { name: true } } },
    }),
    prisma.student.findMany({
      where: { organizationId: user.organizationId, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, studentNo: true },
    }),
  ]);
  const enrolled = distinctEnrolled(enrollments);
  const waiting = new Map<string, { id: string; studentId: string; studentName: string; joinedAt: string }[]>();
  for (const row of waitlist) {
    const list = waiting.get(row.classGroupId) ?? [];
    list.push({ id: row.id, studentId: row.studentId, studentName: row.student.name, joinedAt: formatDateTime(row.createdAt) });
    waiting.set(row.classGroupId, list);
  }

  return (
    <CourseDirectory
      courses={courses.map((course) => ({
        id: course.id,
        name: course.name,
        category: course.category,
        description: course.description,
        billingType: course.billingType,
        status: course.status,
      }))}
      classes={classes.map((item) => ({
        id: item.id,
        name: item.name,
        courseId: item.course.id,
        courseName: item.course.name,
        teacherId: item.teacher.id,
        teacherName: item.teacher.name,
        capacity: item.capacity,
        enrolledCount: enrolled.get(item.id)?.size ?? 0,
        enrolledStudentIds: [...(enrolled.get(item.id) ?? [])],
        full: classIsFull(item.capacity, enrolled.get(item.id)?.size ?? 0),
        overCapacity: item.capacity != null && (enrolled.get(item.id)?.size ?? 0) > item.capacity,
        waitlist: waiting.get(item.id) ?? [],
        hasLessons: item._count.lessonSessions > 0,
        status: item.status,
      }))}
      students={students}
      openClassId={params.class ?? ""}
      openFormKey={params.form === "course" || params.form === "class" ? `${params.form}:${params.open ?? "1"}` : ""}
      courseOptions={courses.filter((course) => course.status === "ACTIVE").map((course) => ({ id: course.id, name: course.name }))}
      teacherOptions={teachers}
    />
  );
}
