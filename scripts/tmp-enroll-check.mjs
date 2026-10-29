import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
try {
  const rows = await p.enrollment.findMany({
    take: 1,
    select: { createdAt: true, organizationId: true },
  });
  console.log("OK", rows.length);
} catch (e) {
  console.error("ERR code=", e.code);
  console.error(e.message);
  if (e.meta) console.error("META", JSON.stringify(e.meta, null, 2));
} finally {
  await p.$disconnect();
}
