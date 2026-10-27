import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user?.roles.includes("OWNER")) return Response.json([], { status: 401 });
  const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 40) ?? "";
  if (!query) return Response.json([]);
  const rows = await prisma.student.findMany({
    where: {
      organizationId: user.organizationId,
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { studentNo: { contains: query, mode: "insensitive" } },
        { guardianPhone: { contains: query } },
      ],
    },
    select: { id: true, name: true, studentNo: true, guardianPhone: true },
    orderBy: { name: "asc" },
    take: 8,
  });
  return Response.json(rows);
}
