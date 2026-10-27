import { prisma } from "@/lib/prisma";

export async function markPublishedReportsRead(organizationId: string, parentUserId: string, reportIds: string[]) {
  const ids = [...new Set(reportIds.filter(Boolean))];
  if (ids.length === 0) return;
  const allowed = await prisma.teachingReport.findMany({
    where: {
      organizationId,
      id: { in: ids },
      status: "PUBLISHED",
      student: { parentLinks: { some: { organizationId, parentUserId } } },
    },
    select: { id: true },
  });
  const allowedIds = allowed.map((row) => row.id);
  if (allowedIds.length === 0) return;
  const existing = await prisma.reportRead.findMany({
    where: { organizationId, parentUserId, reportId: { in: allowedIds } },
    select: { reportId: true },
  });
  const seen = new Set(existing.map((row) => row.reportId));
  const fresh = allowedIds.filter((id) => !seen.has(id));
  if (fresh.length === 0) return;
  await prisma.reportRead.createMany({
    data: fresh.map((reportId) => ({ organizationId, reportId, parentUserId })),
    skipDuplicates: true,
  });
}
