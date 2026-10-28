import { readFile } from "fs/promises";
import { getCurrentUser } from "@/lib/auth";
import { homeworkAssetPath } from "@/lib/homework-files";
import { prisma } from "@/lib/prisma";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });
  const { id } = await context.params;
  const asset = await prisma.homeworkAsset.findFirst({
    where: { id, organizationId: user.organizationId },
    select: {
      id: true,
      contentType: true,
      fileName: true,
      submission: {
        select: {
          studentId: true,
          lessonSession: { select: { teacherId: true } },
        },
      },
    },
  });
  if (!asset) return new Response(null, { status: 404 });

  const teacher = user.roles.includes("TEACHER") || user.roles.includes("OWNER")
    ? await prisma.teacher.findFirst({
        where: { userId: user.id, organizationId: user.organizationId, status: "ACTIVE" },
        select: { id: true },
      })
    : null;
  const teaches = Boolean(teacher && teacher.id === asset.submission.lessonSession.teacherId);
  const ownsAsOwner = user.roles.includes("OWNER");
  const parentOk = user.roles.includes("PARENT")
    ? await prisma.parentStudentLink.findFirst({
        where: { organizationId: user.organizationId, parentUserId: user.id, studentId: asset.submission.studentId },
        select: { id: true },
      })
    : null;
  if (!teaches && !ownsAsOwner && !parentOk) return new Response(null, { status: 404 });

  try {
    let bytes: Buffer;
    try {
      bytes = await readFile(homeworkAssetPath(asset.id, asset.contentType, user.organizationId));
    } catch {
      bytes = await readFile(homeworkAssetPath(asset.id, asset.contentType));
    }
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": asset.contentType,
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`,
        "cache-control": "private, max-age=3600",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
