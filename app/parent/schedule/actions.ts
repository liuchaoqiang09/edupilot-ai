"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export type LeaveResult = { ok: boolean; message: string };

function refreshLeave() {
  revalidatePath("/parent/schedule");
  revalidatePath("/parent/attendance");
  revalidatePath("/teacher");
  revalidatePath("/teacher/schedule");
  revalidatePath("/owner/attendance");
  revalidatePath("/owner/audit");
}

export async function requestParentLeave(formData: FormData): Promise<LeaveResult> {
  const user = await requireRole("PARENT", "parent");
  const lessonStudentId = String(formData.get("lessonStudentId") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (note.length > 80) return { ok: false, message: "请假原因不能超过 80 个字。" };
  const row = await prisma.lessonStudent.findFirst({
    where: { id: lessonStudentId, organizationId: user.organizationId, student: { parentLinks: { some: { parentUserId: user.id } } } },
    select: {
      id: true,
      attendanceStatus: true,
      hoursCharged: true,
      parentLeaveAt: true,
      makeups: { select: { id: true } },
      student: { select: { name: true, status: true } },
      lessonSession: { select: { id: true, startAt: true, status: true, title: true, course: { select: { name: true } } } },
    },
  });
  if (!row || row.lessonSession.status === "CANCELLED") return { ok: false, message: "找不到这节课，或课次已取消。" };
  if (row.student.status !== "ACTIVE") return { ok: false, message: "孩子已停用，不能再请假。历史课次仍可查看。" };
  if (row.lessonSession.startAt.getTime() <= Date.now()) return { ok: false, message: "课次已经开始，不能再请假。" };
  if (row.hoursCharged) return { ok: false, message: "老师已保存考勤并扣过课时，不能再请假。" };
  if (row.makeups.length > 0) return { ok: false, message: "这次请假已安排补课，不能再改。" };
  if (row.parentLeaveAt) return { ok: false, message: "已经提交过请假。" };
  const text = note || "家长请假";
  try {
    await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; hoursCharged: boolean; parentLeaveAt: Date | null; attendanceStatus: string }>>`
        SELECT id, "hoursCharged", "parentLeaveAt", "attendanceStatus"
        FROM "edupilot"."LessonStudent"
        WHERE id = ${row.id} AND "organizationId" = ${user.organizationId}
        FOR UPDATE
      `;
      if (locked.length !== 1) throw new Error("MISSING");
      if (locked[0].hoursCharged) throw new Error("CHARGED");
      if (locked[0].parentLeaveAt) throw new Error("DONE");
      if (locked[0].attendanceStatus !== "NOT_MARKED" && locked[0].attendanceStatus !== "LEAVE") {
        throw new Error("MARKED");
      }
      await tx.lessonStudent.update({
        where: { id: row.id },
        data: {
          attendanceStatus: "LEAVE",
          leaveKind: "PERSONAL",
          attendanceNote: text,
          parentLeaveAt: new Date(),
          parentLeaveNote: text,
          lastAction: "家长请假",
        },
      });
      await writeAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "PARENT_LEAVE",
        targetType: "LessonStudent",
        targetId: row.id,
        detail: `${user.name}为${row.student.name}请假：${row.lessonSession.course.name}${row.lessonSession.title ? ` · ${row.lessonSession.title}` : ""}`,
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "CHARGED") {
      return { ok: false, message: "老师刚保存了考勤，请假没有写入。请刷新后查看最终状态。" };
    }
    if (error instanceof Error && error.message === "DONE") {
      return { ok: false, message: "已经提交过请假。" };
    }
    if (error instanceof Error && error.message === "MARKED") {
      return { ok: false, message: "老师已点名，请假没有写入。最终以老师保存的考勤为准。" };
    }
    if (error instanceof Error && error.message === "MISSING") {
      return { ok: false, message: "名单已变化，请刷新后再试。" };
    }
    throw error;
  }
  refreshLeave();
  return { ok: true, message: "已请假。老师仍可改考勤；最终以老师保存为准。" };
}

export async function cancelParentLeave(formData: FormData): Promise<LeaveResult> {
  const user = await requireRole("PARENT", "parent");
  const lessonStudentId = String(formData.get("lessonStudentId") ?? "");
  const row = await prisma.lessonStudent.findFirst({
    where: { id: lessonStudentId, organizationId: user.organizationId, student: { parentLinks: { some: { parentUserId: user.id } } }, parentLeaveAt: { not: null } },
    select: {
      id: true,
      attendanceStatus: true,
      hoursCharged: true,
      makeups: { select: { id: true } },
      student: { select: { name: true, status: true } },
      lessonSession: { select: { startAt: true, status: true } },
    },
  });
  if (!row || row.lessonSession.status === "CANCELLED") return { ok: false, message: "找不到这次请假记录。" };
  if (row.student.status !== "ACTIVE") return { ok: false, message: "孩子已停用，不能再改请假。" };
  if (row.lessonSession.startAt.getTime() <= Date.now()) return { ok: false, message: "课次已经开始，不能取消请假。" };
  if (row.hoursCharged || row.makeups.length > 0 || row.attendanceStatus !== "LEAVE") {
    return { ok: false, message: "老师已改考勤或已安排补课，不能取消请假。" };
  }
  try {
    await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; hoursCharged: boolean; attendanceStatus: string }>>`
        SELECT id, "hoursCharged", "attendanceStatus"
        FROM "edupilot"."LessonStudent"
        WHERE id = ${row.id} AND "organizationId" = ${user.organizationId}
        FOR UPDATE
      `;
      if (locked.length !== 1) throw new Error("MISSING");
      if (locked[0].hoursCharged || locked[0].attendanceStatus !== "LEAVE") throw new Error("LOCKED");
      await tx.lessonStudent.update({
        where: { id: row.id },
        data: {
          attendanceStatus: "NOT_MARKED",
          leaveKind: null,
          attendanceNote: null,
          parentLeaveAt: null,
          parentLeaveNote: null,
          lastAction: "家长取消请假",
        },
      });
    });
  } catch (error) {
    if (error instanceof Error && (error.message === "LOCKED" || error.message === "MISSING")) {
      return { ok: false, message: "老师已改考勤，取消请假没有生效。请刷新查看。" };
    }
    throw error;
  }
  refreshLeave();
  return { ok: true, message: "已取消请假。" };
}
