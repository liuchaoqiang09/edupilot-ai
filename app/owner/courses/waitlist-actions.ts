"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { classIsFull } from "@/lib/class-occupancy";
import { prisma } from "@/lib/prisma";

function refresh() {
  revalidatePath("/owner/courses");
  revalidatePath("/owner/todos");
  revalidatePath("/owner/schedule");
}

export async function joinClassWaitlist(classGroupId: string, formData: FormData): Promise<{ ok: boolean; message?: string }> {
  const user = await requireRole("OWNER", "owner");
  const studentId = typeof formData.get("studentId") === "string" ? formData.get("studentId")!.toString().trim() : "";
  if (!studentId) return { ok: false, message: "请选择学生。" };
  const classGroup = await prisma.classGroup.findFirst({
    where: { id: classGroupId, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!classGroup) return { ok: false, message: "只能给本机构启用中的班级排队。" };
  const student = await prisma.student.findFirst({
    where: { id: studentId, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!student) return { ok: false, message: "只能选择本机构在读的学生。" };
  const enrolled = await prisma.enrollment.findFirst({
    where: { organizationId: user.organizationId, classGroupId, studentId, student: { status: "ACTIVE" } },
    select: { id: true },
  });
  if (enrolled) return { ok: false, message: "这名学生已经在这个班里，不用排队。" };
  const queued = await prisma.classWaitlist.findFirst({
    where: { organizationId: user.organizationId, classGroupId, studentId },
    select: { id: true },
  });
  if (queued) return { ok: false, message: "这名学生已经在排队。" };
  await prisma.classWaitlist.create({
    data: { organizationId: user.organizationId, classGroupId, studentId },
  });
  refresh();
  return { ok: true, message: "已加入排队。排队期间不算在读，也不会进入课表。" };
}

export async function admitWaitlist(waitlistId: string): Promise<{ ok: boolean; message?: string }> {
  const user = await requireRole("OWNER", "owner");
  const row = await prisma.classWaitlist.findFirst({
    where: { id: waitlistId, organizationId: user.organizationId },
    select: {
      id: true,
      studentId: true,
      classGroupId: true,
      student: { select: { name: true, status: true } },
      classGroup: { select: { id: true, name: true, capacity: true, status: true, courseId: true, course: { select: { name: true } } } },
    },
  });
  if (!row || row.classGroup.status !== "ACTIVE") return { ok: false, message: "这条排队不存在，或班级已经归档。" };
  if (row.student.status !== "ACTIVE") return { ok: false, message: "这名学生已停用，不能转入班级。" };
  const members = await prisma.enrollment.findMany({
    where: { organizationId: user.organizationId, classGroupId: row.classGroupId, student: { status: "ACTIVE" } },
    select: { studentId: true },
  });
  const enrolledIds = new Set(members.map((item) => item.studentId));
  const alreadyHere = enrolledIds.has(row.studentId);
  if (!alreadyHere && classIsFull(row.classGroup.capacity, enrolledIds.size)) {
    return { ok: false, message: `「${row.classGroup.name}」已满，容量 ${row.classGroup.capacity}，当前在读 ${enrolledIds.size}。腾出位置后再转入。` };
  }
  const enrollment = await prisma.enrollment.findFirst({
    where: { organizationId: user.organizationId, studentId: row.studentId, courseId: row.classGroup.courseId },
    orderBy: { createdAt: "desc" },
    select: { id: true, classGroupId: true },
  });
  if (!enrollment) return { ok: false, message: "这名学生还没有这门课的报名。请先记录报名，再转入班级。" };
  await prisma.$transaction(async (tx) => {
    await tx.enrollment.updateMany({
      where: { organizationId: user.organizationId, studentId: row.studentId, courseId: row.classGroup.courseId },
      data: { classGroupId: row.classGroupId },
    });
    await tx.classWaitlist.delete({ where: { id: row.id } });
  });
  refresh();
  revalidatePath("/owner/billing");
  return { ok: true, message: alreadyHere ? `${row.student.name} 已经在这个班，已从排队中移除。` : `${row.student.name} 已转入「${row.classGroup.name}」，并移出排队。` };
}
