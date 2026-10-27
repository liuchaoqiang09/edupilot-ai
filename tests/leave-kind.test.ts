import assert from "node:assert/strict";
import test from "node:test";
import {
  attendanceDisplayLabel,
  attendanceDisplayTone,
  leaveKindLabel,
  toAttendanceFields,
  toAttendanceUi,
} from "@/lib/leave-kind";

test("UI 事假病假映射为 LEAVE + leaveKind", () => {
  assert.deepEqual(toAttendanceFields("PERSONAL"), { status: "LEAVE", leaveKind: "PERSONAL" });
  assert.deepEqual(toAttendanceFields("SICK"), { status: "LEAVE", leaveKind: "SICK" });
  assert.deepEqual(toAttendanceFields("LEAVE"), { status: "LEAVE", leaveKind: "PERSONAL" });
  assert.deepEqual(toAttendanceFields("ABSENT"), { status: "ABSENT", leaveKind: null });
  assert.deepEqual(toAttendanceFields("PRESENT"), { status: "PRESENT", leaveKind: null });
  assert.equal(toAttendanceFields("bogus"), null);
});

test("展示：事假橙色、病假灰色；旧 LEAVE 无 leaveKind 当人事假", () => {
  assert.equal(attendanceDisplayLabel("LEAVE", "PERSONAL"), leaveKindLabel.PERSONAL);
  assert.equal(attendanceDisplayLabel("LEAVE", "SICK"), leaveKindLabel.SICK);
  assert.equal(attendanceDisplayLabel("LEAVE", null), leaveKindLabel.PERSONAL);
  assert.equal(toAttendanceUi("LEAVE", null), "PERSONAL");
  assert.equal(toAttendanceUi("LEAVE", "SICK"), "SICK");
  assert.match(attendanceDisplayTone("LEAVE", "PERSONAL"), /#c27b35/);
  assert.match(attendanceDisplayTone("LEAVE", "SICK"), /#74838b/);
});
