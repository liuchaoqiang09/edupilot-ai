import { CourseDirectory } from "@/components/course-directory";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function CoursesPage() {
  const user = await requireRole("OWNER", "owner");

  const [courses, classes, teachers] = await Promise.all([
    prisma.course.findMany({
      where: { organizationId: user.organizationId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    }),
    prisma.classGroup.findMany({
      where: { organizationId: user.organizationId },
      include: {
        course: { select: { name: true } },
        teacher: { select: { name: true } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    }),
    prisma.teacher.findMany({
      where: { organizationId: user.organizationId, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <CourseDirectory
      courses={courses.map((course) => ({
        id: course.id,
        name: course.name,
        category: course.category,
        description: course.description,
        status: course.status,
      }))}
      classes={classes.map((item) => ({
        id: item.id,
        name: item.name,
        courseName: item.course.name,
        teacherName: item.teacher.name,
        capacity: item.capacity,
        status: item.status,
      }))}
      courseOptions={courses.filter((course) => course.status === "ACTIVE").map((course) => ({ id: course.id, name: course.name }))}
      teacherOptions={teachers}
    />
  );
}
