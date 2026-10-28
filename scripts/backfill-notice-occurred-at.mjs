import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

async function main() {
  // Prisma client after generate; use SQL backfill via prisma for speed.
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  const rows = await prisma.parentNotice.findMany({
    select: { id: true, body: true, createdAt: true, occurredAt: true },
  });
  let updated = 0;
  for (const row of rows) {
    const body = String(row.body);
    let next = null;
    const cn = body.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (cn) {
      const year = cn[1];
      const month = cn[2].padStart(2, "0");
      const day = cn[3].padStart(2, "0");
      const time = body.slice(cn.index + cn[0].length).match(/(\d{1,2}):(\d{2})/);
      const hour = time ? time[1].padStart(2, "0") : "12";
      const minute = time ? time[2] : "00";
      next = new Date(`${year}-${month}-${day}T${hour}:${minute}:00+08:00`);
    } else {
      const short = body.match(/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
      if (short) {
        const year = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric" }).format(row.createdAt);
        next = new Date(`${year}-${short[1].padStart(2, "0")}-${short[2].padStart(2, "0")}T${short[3].padStart(2, "0")}:${short[4]}:00+08:00`);
      }
    }
    if (!next || Number.isNaN(next.getTime()) || next.getTime() === row.occurredAt.getTime()) continue;
    await prisma.parentNotice.update({ where: { id: row.id }, data: { occurredAt: next } });
    updated += 1;
  }
  console.log(`backfilled occurredAt for ${updated} / ${rows.length} notices`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
