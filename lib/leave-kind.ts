import type { AttendanceStatus, LeaveKind, Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { CourseHourError, syncAttendanceCharge } from "@/lib/course-hours";

export const leaveKindLabel = {
  PERSONAL: "事假",
  SICK: "病假",
} as const;

export type AttendanceUiValue = "NOT_MARKED" | "PRESENT" | "ABSENT" | "LATE" | "PERSONAL" | "SICK";

export const attendanceUiOptions: { value: AttendanceUiValue; label: string }[] = [
  { value: "NOT_MARKED", label: "未标记" },
  { value: "PRESENT", label: "出勤" },
  { value: "ABSENT", label: "缺勤" },
  { value: "LATE", label: "迟到" },
  { value: "PERSONAL", label: "事假" },
  { value: "SICK", label: "病假" },
];

export function parseLeaveKind(value: string | null | undefined): LeaveKind | null {
  if (value === "PERSONAL" || value === "SICK") return value;
  return null;
}

export function toAttendanceFields(ui: string): { status: AttendanceStatus; leaveKind: LeaveKind | null } | null {
  if (ui === "PERSONAL") return { status: "LEAVE", leaveKind: "PERSONAL" };
  if (ui === "SICK") return { status: "LEAVE", leaveKind: "SICK" };
  if (ui === "NOT_MARKED" || ui === "PRESENT" || ui === "ABSENT" || ui === "LATE" || ui === "LEAVE") {
    return { status: ui, leaveKind: ui === "LEAVE" ? "PERSONAL" : null };
  }
  return null;
}

export function toAttendanceUi(status: AttendanceStatus, leaveKind: LeaveKind | null | undefined): AttendanceUiValue {
  if (status === "LEAVE") return leaveKind === "SICK" ? "SICK" : "PERSONAL";
  return status;
}

export function attendanceDisplayLabel(status: AttendanceStatus, leaveKind: LeaveKind | null | undefined) {
  if (status === "LEAVE") return leaveKind === "SICK" ? leaveKindLabel.SICK : leaveKindLabel.PERSONAL;
  const map = { NOT_MARKED: "未标记", PRESENT: "出勤", ABSENT: "缺勤", LATE: "迟到", LEAVE: "请假" } as const;
  return map[status];
}

/** 事假橙色，病假灰色；其余沿用原色。 */
export function attendanceDisplayTone(status: AttendanceStatus, leaveKind: LeaveKind | null | undefined) {
  if (status === "LEAVE") {
    return leaveKind === "SICK" ? "font-bold text-[#74838b]" : "font-bold text-[#c27b35]";
  }
  if (status === "PRESENT") return "font-bold text-[#34725d]";
  if (status === "ABSENT") return "font-bold text-[#b94d4d]";
  if (status === "LATE") return "font-bold text-[#9a6729]";
  return "";
}

export function leaveBadgeClass(leaveKind: LeaveKind | null | undefined) {
  return leaveKind === "SICK"
    ? "rounded-full bg-[#eef1ee] px-2 py-0.5 text-[10px] font-bold text-[#74838b]"
    : "rounded-full bg-[#fff2df] px-2 py-0.5 text-[10px] font-bold text-[#9a6729]";
}

type Tx = Prisma.TransactionClient;

export async function convertAbsentToLeaveInTx(
  tx: Tx,
  input: {
    organizationId: string;
    actorId: string;
    actorRole: "教师" | "负责人";
    lessonStudentId: string;
    leaveKind: LeaveKind;
    note?: string | null;
  },
) {
  const row = await tx.lessonStudent.findFirst({
    where: { id: input.lessonStudentId, organizationId: input.organizationId },
    select: {
      id: true,
      studentId: true,
      attendanceStatus: true,
      hoursCharged: true,
      seat: true,
      makeups: { select: { id: true }, take: 1 },
      student: { select: { name: true, status: true } },
      lessonSession: {
        select: {
          id: true,
          status: true,
          courseId: true,
          course: { select: { name: true, billingType: true } },
        },
      },
    },
  });
  if (!row || row.lessonSession.status === "CANCELLED") {
    throw new CourseHourError("找不到这条考勤，或课次已取消。");
  }
  if (row.student.status !== "ACTIVE") throw new CourseHourError("这名学生已停用，不能安排补课。");
  if (row.attendanceStatus !== "ABSENT") throw new CourseHourError("只有缺勤记录才能一键转为请假并补课。");
  if (row.makeups.length > 0) throw new CourseHourError("这条记录已经安排过补课。");

  const kindLabel = leaveKindLabel[input.leaveKind];
  const note = input.note?.trim() || `缺勤转为${kindLabel}`;
  const outcome = await syncAttendanceCharge(tx, {
    organizationId: input.organizationId,
    lessonStudentId: row.id,
    studentId: row.studentId,
    studentName: row.student.name,
    courseId: row.lessonSession.courseId,
    courseName: row.lessonSession.course.name,
    billingType: row.lessonSession.course.billingType,
    seat: row.seat,
    shouldCharge: false,
    attendanceStatus: "LEAVE",
    attendanceNote: note,
    leaveKind: input.leaveKind,
  });

  const moneyNote = outcome === "refunded" ? "退回1课时" : "仅改状态，未扣课时无需退回";
  await writeAudit(tx, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    action: "ABSENT_TO_LEAVE",
    targetType: "LessonStudent",
    targetId: row.id,
    detail: `${input.actorRole}将${row.student.name}从缺勤改为${kindLabel}，${moneyNote}`,
  });

  return {
    sourceId: row.id,
    studentName: row.student.name,
    courseId: row.lessonSession.courseId,
    lessonId: row.lessonSession.id,
    refunded: outcome === "refunded",
    leaveKind: input.leaveKind,
  };
}
