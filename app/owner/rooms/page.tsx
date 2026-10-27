import { RoomDirectory } from "@/components/room-directory";
import { requireRole } from "@/lib/auth";
import { shanghaiDateKey, shanghaiWeekRange, weekStartKey } from "@/lib/datetime";
import { samePlaceText } from "@/lib/lesson-conflicts";
import { prisma } from "@/lib/prisma";

export default async function RoomsPage({ searchParams }: { searchParams: Promise<{ form?: string; open?: string }> }) {
  const user = await requireRole("OWNER", "owner");
  const params = await searchParams;
  const today = shanghaiDateKey();
  const week = shanghaiWeekRange();
  const weekStart = weekStartKey(today);
  const [rooms, weekLessons, looseLessons] = await Promise.all([
    prisma.classroom.findMany({
      where: { organizationId: user.organizationId },
      orderBy: [{ available: "desc" }, { name: "asc" }],
      select: { id: true, name: true, capacity: true, available: true },
    }),
    prisma.lessonSession.findMany({
      where: { organizationId: user.organizationId, status: { not: "CANCELLED" }, startAt: { gte: week.start, lt: week.end } },
      select: { classroomId: true, location: true },
    }),
    prisma.lessonSession.findMany({
      where: { organizationId: user.organizationId, classroomId: null, location: { not: null }, status: { not: "CANCELLED" } },
      select: { location: true },
    }),
  ]);
  return (
    <RoomDirectory
      weekStart={weekStart}
      today={today}
      openFormKey={params.form === "create" ? params.open ?? "1" : ""}
      rooms={rooms.map((room) => ({
        id: room.id,
        name: room.name,
        capacity: room.capacity,
        available: room.available,
        weekCount: weekLessons.filter((lesson) => lesson.classroomId === room.id || (!lesson.classroomId && samePlaceText(lesson.location, room.name))).length,
        looseCount: looseLessons.filter((lesson) => samePlaceText(lesson.location, room.name)).length,
      }))}
    />
  );
}
