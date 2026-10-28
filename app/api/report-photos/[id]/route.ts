import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readReportPhotoBytes, reportPhotoExt } from "@/lib/report-photos";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });
  const { id } = await context.params;
  const photo = await prisma.reportPhoto.findFirst({
    where: { id, organizationId: user.organizationId },
    select: {
      id: true,
      contentType: true,
      report: { select: { status: true, studentId: true, lessonSession: { select: { teacherId: true } } } },
    },
  });
  if (!photo) return new Response(null, { status: 404 });
  const teacher = user.roles.includes("TEACHER")
    ? await prisma.teacher.findFirst({ where: { userId: user.id, organizationId: user.organizationId, status: "ACTIVE" }, select: { id: true } })
    : null;
  const teaches = teacher?.id === photo.report.lessonSession.teacherId;
  const owns = user.roles.includes("OWNER");
  const parent = user.roles.includes("PARENT") && photo.report.status === "PUBLISHED"
    ? await prisma.parentStudentLink.findFirst({ where: { organizationId: user.organizationId, parentUserId: user.id, studentId: photo.report.studentId }, select: { id: true } })
    : null;
  if (!teaches && !owns && !parent) return new Response(null, { status: 403 });
  if (!reportPhotoExt(photo.contentType)) return new Response(null, { status: 404 });
  try {
    const bytes = await readReportPhotoBytes(photo.id, photo.contentType, user.organizationId);
    return new Response(new Uint8Array(bytes), { headers: { "content-type": photo.contentType, "cache-control": "private, max-age=3600" } });
  } catch {
    return new Response(null, { status: 404 });
  }
}
