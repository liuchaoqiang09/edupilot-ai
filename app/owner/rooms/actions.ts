"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { samePlaceText } from "@/lib/lesson-conflicts";
import { prisma } from "@/lib/prisma";

export type RoomErrors = Partial<Record<"name" | "capacity", string>>;

export type RoomResult = {
  ok: boolean;
  message?: string;
  fieldErrors?: RoomErrors;
  needsDisableConfirm?: boolean;
};

function clean(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function readRoom(formData: FormData) {
  const errors: RoomErrors = {};
  const name = clean(formData.get("name"));
  const capacityText = clean(formData.get("capacity"));
  const capacity = Number(capacityText);
  if (!name) errors.name = "请填写教室名称。";
  else if (name.length > 40) errors.name = "教室名称不能超过 40 个字。";
  if (!/^\d+$/.test(capacityText) || !Number.isInteger(capacity) || capacity < 1 || capacity > 500) {
    errors.capacity = "容量请填 1 到 500 的整数。";
  }
  return { errors, name, capacity, available: formData.get("available") === "1" };
}

async function linkMatchingLessons(organizationId: string, classroomId: string, name: string) {
  const rows = await prisma.lessonSession.findMany({
    where: { organizationId, classroomId: null, location: { not: null } },
    select: { id: true, location: true },
  });
  const ids = rows.filter((row) => samePlaceText(row.location, name)).map((row) => row.id);
  if (ids.length === 0) return 0;
  await prisma.lessonSession.updateMany({
    where: { id: { in: ids }, organizationId, classroomId: null },
    data: { classroomId, location: name },
  });
  return ids.length;
}

function linkMessage(requested: boolean, linked: number) {
  if (!requested) return "";
  return linked > 0
    ? `已把 ${linked} 节地点文字相同的旧课次挂到这间教室。`
    : "没有地点文字相同、且还没挂教室的课次。";
}

export async function createClassroom(formData: FormData): Promise<RoomResult> {
  const user = await requireRole("OWNER", "owner");
  const room = readRoom(formData);
  if (Object.keys(room.errors).length > 0) return { ok: false, fieldErrors: room.errors };
  const taken = await prisma.classroom.findFirst({
    where: { organizationId: user.organizationId, name: room.name },
    select: { id: true },
  });
  if (taken) return { ok: false, fieldErrors: { name: "本机构已经有同名教室。" } };
  const created = await prisma.classroom.create({
    data: {
      organizationId: user.organizationId,
      name: room.name,
      capacity: room.capacity,
      available: room.available,
    },
    select: { id: true },
  });
  const linked = formData.get("linkMatches") === "1"
    ? await linkMatchingLessons(user.organizationId, created.id, room.name)
    : 0;
  revalidatePath("/owner/rooms");
  revalidatePath("/owner/schedule");
  return { ok: true, message: linkMessage(formData.get("linkMatches") === "1", linked) };
}

async function upcomingCount(organizationId: string, classroomId: string, name: string) {
  const rows = await prisma.lessonSession.findMany({
    where: {
      organizationId,
      status: { not: "CANCELLED" },
      startAt: { gt: new Date() },
      OR: [{ classroomId }, { classroomId: null, location: { not: null } }],
    },
    select: { classroomId: true, location: true },
  });
  return rows.filter((row) => row.classroomId === classroomId || samePlaceText(row.location, name)).length;
}

export async function updateClassroom(classroomId: string, formData: FormData): Promise<RoomResult> {
  const user = await requireRole("OWNER", "owner");
  const room = readRoom(formData);
  if (Object.keys(room.errors).length > 0) return { ok: false, fieldErrors: room.errors };
  const current = await prisma.classroom.findFirst({
    where: { id: classroomId, organizationId: user.organizationId },
    select: { id: true, available: true, name: true },
  });
  if (!current) return { ok: false, message: "这间教室不存在。" };
  const taken = await prisma.classroom.findFirst({
    where: { organizationId: user.organizationId, name: room.name, id: { not: classroomId } },
    select: { id: true },
  });
  if (taken) return { ok: false, fieldErrors: { name: "本机构已经有同名教室。" } };
  if (current.available && !room.available && formData.get("confirmDisable") !== "1") {
    const future = await upcomingCount(user.organizationId, classroomId, room.name);
    if (future > 0) {
      return {
        ok: false,
        needsDisableConfirm: true,
        message: `这间教室还有 ${future} 节未取消、尚未开始的课。停用后这些课保留，新排课不能再选它。再点一次保存才会停用。`,
      };
    }
  }
  const saved = await prisma.classroom.updateMany({
    where: { id: classroomId, organizationId: user.organizationId },
    data: { name: room.name, capacity: room.capacity, available: room.available },
  });
  if (saved.count !== 1) return { ok: false, message: "这间教室不存在。" };
  if (current.name !== room.name) {
    await prisma.lessonSession.updateMany({
      where: { organizationId: user.organizationId, classroomId },
      data: { location: room.name },
    });
  }
  const linked = formData.get("linkMatches") === "1"
    ? await linkMatchingLessons(user.organizationId, classroomId, room.name)
    : 0;
  revalidatePath("/owner/rooms");
  revalidatePath("/owner/schedule");
  return { ok: true, message: linkMessage(formData.get("linkMatches") === "1", linked) };
}
