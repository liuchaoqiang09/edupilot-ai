import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export type ParentLeaveActor = {
  id: string;
  name: string;
  organizationId: string;
};

export type ParentLeaveResult = { ok: boolean; message: string };

/** 家长请假：锁行、拒已扣课时、拒老师已点名。UI 与小星助教共用。 */
export async function applyParentLeave(
  actor: ParentLeaveActor,
  input: { lessonStudentId: string; note: string },
): Promise<ParentLeaveResult> {
  const note = input.note.trim();
  if (note.length > 80) return { ok: false, message: "请假原因不能超过 80 个字。" };
  const row = await prisma.lessonStudent.findFirst({
    where: {
      id: input.lessonStudentId,
      organizationId: actor.organizationId,
      student: { parentLinks: { some: { parentUserId: actor.id } } },
    },
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
  if (row.attendanceStatus !== "NOT_MARKED" && row.attendanceStatus !== "LEAVE") {
    return { ok: false, message: "老师已点名，不能再请假。最终以老师保存的考勤为准。" };
  }
  const text = note || "家长请假";
  try {
    await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; hoursCharged: boolean; parentLeaveAt: Date | null; attendanceStatus: string; startAt: Date; makeupCount: bigint }>>`
        SELECT ls.id, ls."hoursCharged", ls."parentLeaveAt", ls."attendanceStatus",
               sess."startAt" AS "startAt",
               (SELECT COUNT(*)::bigint FROM "edupilot"."LessonStudent" m WHERE m."makeupSourceId" = ls.id) AS "makeupCount"
        FROM "edupilot"."LessonStudent" ls
        INNER JOIN "edupilot"."LessonSession" sess ON sess.id = ls."lessonSessionId"
        WHERE ls.id = ${row.id} AND ls."organizationId" = ${actor.organizationId}
        FOR UPDATE OF ls, sess
      `;
      // #region agent log
      fetch('http://127.0.0.1:7864/ingest/c74576bd-578e-450c-9e38-57993de03fbf',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'70ce49'},body:JSON.stringify({sessionId:'70ce49',hypothesisId:'H1',location:'lib/parent-leave.ts:applyParentLeave-lock',message:'leave_lock_state',data:{found:locked.length,hoursCharged:locked[0]?.hoursCharged??null,attendanceStatus:locked[0]?.attendanceStatus??null,startAt:locked[0]?.startAt?new Date(locked[0].startAt).toISOString():null,makeupCount:locked[0]?Number(locked[0].makeupCount):null,now:new Date().toISOString()},timestamp:Date.now(),runId:'leave-race'})}).catch(()=>{});
      // #endregion
      if (locked.length !== 1) throw new Error("MISSING");
      if (new Date(locked[0].startAt).getTime() <= Date.now()) throw new Error("STARTED");
      if (Number(locked[0].makeupCount) > 0) throw new Error("MAKEUP");
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
        organizationId: actor.organizationId,
        actorId: actor.id,
        action: "PARENT_LEAVE",
        targetType: "LessonStudent",
        targetId: row.id,
        detail: `${actor.name}为${row.student.name}请假：${row.lessonSession.course.name}${row.lessonSession.title ? ` · ${row.lessonSession.title}` : ""}`,
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "STARTED") {
      return { ok: false, message: "课次已经开始，不能再请假。" };
    }
    if (error instanceof Error && error.message === "MAKEUP") {
      return { ok: false, message: "这次请假已安排补课，不能再改。" };
    }
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
  return { ok: true, message: "已请假。老师仍可改考勤；最终以老师保存为准。" };
}

/** 取消家长请假：锁行、拒已扣课时/已改考勤/已补课。 */
export async function applyCancelParentLeave(
  actor: ParentLeaveActor,
  input: { lessonStudentId: string },
): Promise<ParentLeaveResult> {
  const row = await prisma.lessonStudent.findFirst({
    where: {
      id: input.lessonStudentId,
      organizationId: actor.organizationId,
      parentLeaveAt: { not: null },
      student: { parentLinks: { some: { parentUserId: actor.id } } },
    },
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
      const locked = await tx.$queryRaw<Array<{ id: string; hoursCharged: boolean; attendanceStatus: string; startAt: Date; makeupCount: bigint }>>`
        SELECT ls.id, ls."hoursCharged", ls."attendanceStatus",
               sess."startAt" AS "startAt",
               (SELECT COUNT(*)::bigint FROM "edupilot"."LessonStudent" m WHERE m."makeupSourceId" = ls.id) AS "makeupCount"
        FROM "edupilot"."LessonStudent" ls
        INNER JOIN "edupilot"."LessonSession" sess ON sess.id = ls."lessonSessionId"
        WHERE ls.id = ${row.id} AND ls."organizationId" = ${actor.organizationId}
        FOR UPDATE OF ls, sess
      `;
      // #region agent log
      fetch('http://127.0.0.1:7864/ingest/c74576bd-578e-450c-9e38-57993de03fbf',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'70ce49'},body:JSON.stringify({sessionId:'70ce49',hypothesisId:'H2',location:'lib/parent-leave.ts:applyCancelParentLeave-lock',message:'cancel_lock_state',data:{found:locked.length,hoursCharged:locked[0]?.hoursCharged??null,attendanceStatus:locked[0]?.attendanceStatus??null,startAt:locked[0]?.startAt?new Date(locked[0].startAt).toISOString():null,makeupCount:locked[0]?Number(locked[0].makeupCount):null},timestamp:Date.now(),runId:'leave-race'})}).catch(()=>{});
      // #endregion
      if (locked.length !== 1) throw new Error("MISSING");
      if (new Date(locked[0].startAt).getTime() <= Date.now()) throw new Error("STARTED");
      if (Number(locked[0].makeupCount) > 0) throw new Error("MAKEUP");
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
      await writeAudit(tx, {
        organizationId: actor.organizationId,
        actorId: actor.id,
        action: "PARENT_LEAVE_CANCEL",
        targetType: "LessonStudent",
        targetId: row.id,
        detail: `${actor.name}取消了${row.student.name}的请假`,
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "STARTED") {
      return { ok: false, message: "课次已经开始，不能取消请假。" };
    }
    if (error instanceof Error && error.message === "MAKEUP") {
      return { ok: false, message: "老师已改考勤或已安排补课，不能取消请假。" };
    }
    if (error instanceof Error && (error.message === "LOCKED" || error.message === "MISSING")) {
      return { ok: false, message: "老师已改考勤，取消请假没有生效。请刷新查看。" };
    }
    throw error;
  }
  return { ok: true, message: "已取消请假。" };
}
