import assert from "node:assert/strict";
import test from "node:test";
import {
  combinedClassHintCounts,
  initialDeskDraft,
  markRemainingPresentDraft,
  type DeskStudent,
} from "@/lib/attendance-desk";

function student(overrides: Partial<DeskStudent> & { id: string }): DeskStudent {
  return {
    inactive: false,
    attendanceStatus: "NOT_MARKED",
    leaveKind: null,
    attendanceNote: null,
    parentLeave: false,
    seat: "ENROLLED",
    ...overrides,
  };
}

test("打开签到台：未标记预选出勤，请假保持事假/病假", () => {
  const draft = initialDeskDraft([
    student({ id: "a", attendanceStatus: "NOT_MARKED" }),
    student({ id: "b", attendanceStatus: "LEAVE", leaveKind: "SICK" }),
    student({ id: "c", attendanceStatus: "ABSENT" }),
  ]);
  assert.equal(draft.a.status, "PRESENT");
  assert.equal(draft.b.status, "SICK");
  assert.equal(draft.c.status, "ABSENT");
});

test("未点的标出勤：不覆盖已改的缺勤/迟到/请假", () => {
  const students = [
    student({ id: "a", attendanceStatus: "NOT_MARKED" }),
    student({ id: "b", attendanceStatus: "NOT_MARKED" }),
    student({ id: "c", attendanceStatus: "NOT_MARKED" }),
    student({ id: "d", attendanceStatus: "PRESENT" }),
  ];
  const current = {
    a: { status: "PRESENT" as const, note: "" },
    b: { status: "ABSENT" as const, note: "没来" },
    c: { status: "LATE" as const, note: "" },
    d: { status: "PRESENT" as const, note: "" },
  };
  const next = markRemainingPresentDraft(students, current);
  assert.equal(next.a.status, "PRESENT");
  assert.equal(next.b.status, "ABSENT", "缺勤不能被盖掉");
  assert.equal(next.c.status, "LATE", "迟到不能被盖掉");
  assert.equal(next.d.status, "PRESENT");
});

test("合班提示：临时与已转正分开计数", () => {
  const counts = combinedClassHintCounts([
    student({ id: "1", seat: "GUEST" }),
    student({ id: "2", seat: "GUEST" }),
    student({ id: "3", seat: "CONVERTED" }),
    student({ id: "4", seat: "TRIAL" }),
    student({ id: "5", seat: "ENROLLED" }),
  ]);
  assert.deepEqual(counts, { guest: 2, converted: 1, trial: 1 });
});
