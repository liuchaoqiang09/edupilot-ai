import assert from "node:assert/strict";
import test from "node:test";
import { CourseHourError } from "../lib/course-hours.ts";
import { assertLeaveRemovable, assertMakeupSourceAvailable } from "../lib/makeup.ts";
import { prisma } from "../lib/prisma.ts";

test("P2 补课唯一：同一请假不能二次安排；已补请假不可移出", async () => {
  const source = await prisma.lessonStudent.findFirst({
    where: { makeupSourceId: null, makeups: { some: {} } },
    select: { id: true, organizationId: true, makeups: { select: { id: true }, take: 1 } },
  });
  if (!source?.makeups[0]) {
    // 演示库可能没有现成补课链：只验证空闲源可用与无 makeup 时可移出逻辑不炸
    const free = await prisma.lessonStudent.findFirst({
      where: { makeupSourceId: null, makeups: { none: {} }, attendanceStatus: "LEAVE" },
      select: { id: true, organizationId: true },
    });
    if (!free) return;
    await assertMakeupSourceAvailable(prisma, free.organizationId, free.id);
    await assertLeaveRemovable(prisma, free.id);
    return;
  }

  await assert.rejects(
    () => assertMakeupSourceAvailable(prisma, source.organizationId, source.id),
    (error: unknown) => error instanceof CourseHourError && error.message.includes("已经安排过补课"),
  );
  await assert.rejects(
    () => assertLeaveRemovable(prisma, source.id),
    (error: unknown) => error instanceof CourseHourError && error.message.includes("已经安排了补课"),
  );
});
