import { prisma } from "../lib/prisma.ts";
const row = await prisma.homeworkSubmission.findFirst({
  where: { student: { name: "林子涵" }, status: "SUBMITTED" },
  select: { id: true, lessonSessionId: true },
  orderBy: { submittedAt: "desc" },
});
console.log(JSON.stringify(row));
await prisma.$disconnect();
