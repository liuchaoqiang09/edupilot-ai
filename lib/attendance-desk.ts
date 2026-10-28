import { toAttendanceUi, type AttendanceUiValue } from "@/lib/leave-kind";

export type DeskStudent = {
  id: string;
  inactive: boolean;
  attendanceStatus: "NOT_MARKED" | "PRESENT" | "ABSENT" | "LATE" | "LEAVE";
  leaveKind: "PERSONAL" | "SICK" | null;
  attendanceNote: string | null;
  parentLeave: boolean;
  seat: "ENROLLED" | "GUEST" | "TRIAL" | "CONVERTED";
};

export type DeskDraft = { status: AttendanceUiValue; note: string };

/** 打开签到台时：库未标记预选出勤，其余跟库。 */
export function initialDeskDraft(students: DeskStudent[]): Record<string, DeskDraft> {
  const next: Record<string, DeskDraft> = {};
  for (const student of students) {
    next[student.id] = {
      status: student.attendanceStatus === "NOT_MARKED" ? "PRESENT" : toAttendanceUi(student.attendanceStatus, student.leaveKind),
      note: student.attendanceNote ?? "",
    };
  }
  return next;
}

/**
 * 仅把「仍待处理」的标为出勤：
 * - 草稿仍是未标记；或
 * - 库中未标记且草稿还是打开时的预选出勤（未改成缺勤/迟到等）
 * 不覆盖已选的缺勤、迟到、事假、病假。
 */
export function markRemainingPresentDraft(
  students: DeskStudent[],
  current: Record<string, DeskDraft>,
): Record<string, DeskDraft> {
  const next = { ...current };
  for (const student of students) {
    if (student.inactive) continue;
    const prior = next[student.id];
    if (!prior) continue;
    if (prior.status === "PERSONAL" || prior.status === "SICK" || prior.status === "ABSENT" || prior.status === "LATE") {
      continue;
    }
    if (prior.status === "NOT_MARKED") {
      next[student.id] = { ...prior, status: "PRESENT" };
      continue;
    }
    if (student.attendanceStatus === "NOT_MARKED" && prior.status === "PRESENT") {
      next[student.id] = { ...prior, status: "PRESENT" };
    }
  }
  return next;
}

/** 保存或转假后，用库状态重建草稿。 */
export function syncDeskDraftFromLesson(students: DeskStudent[]): Record<string, DeskDraft> {
  return initialDeskDraft(students);
}

export function combinedClassHintCounts(students: DeskStudent[]) {
  let guest = 0;
  let converted = 0;
  let trial = 0;
  for (const student of students) {
    if (student.seat === "GUEST") guest += 1;
    else if (student.seat === "CONVERTED") converted += 1;
    else if (student.seat === "TRIAL") trial += 1;
  }
  return { guest, converted, trial };
}
