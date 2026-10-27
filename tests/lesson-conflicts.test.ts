import assert from "node:assert/strict";
import test from "node:test";
import { findScheduleConflicts, normalizeRoom, recurringConflictMessage, roomCapacityWarning, samePlaceText, singleConflictWarning, type ExistingLesson } from "@/lib/lesson-conflicts";

const at = (value: string) => new Date(value);
const when = (date: Date) => date.toISOString();

function lesson(overrides: Partial<ExistingLesson> = {}): ExistingLesson {
  return {
    id: "lesson-1",
    title: "已有课",
    startAt: at("2026-10-25T08:00:00.000Z"),
    endAt: at("2026-10-25T09:30:00.000Z"),
    teacherId: "teacher-a",
    classGroupId: "class-a",
    location: "A201",
    classroomId: null,
    students: [{ id: "student-1", name: "郑一鸣", studentNo: "STU-0010" }],
    ...overrides,
  };
}

const baseSlot = {
  teacherId: "teacher-b",
  classGroupId: "class-b",
  location: "B101",
  studentIds: ["student-2"],
  startAt: at("2026-10-25T08:00:00.000Z"),
  endAt: at("2026-10-25T09:30:00.000Z"),
};

test("room comparison ignores case and surrounding spaces", () => {
  assert.equal(normalizeRoom(" A201 "), "a201");
  assert.equal(normalizeRoom("a201"), normalizeRoom("A201"));
  assert.equal(normalizeRoom("  "), null);
  assert.notEqual(normalizeRoom("A201"), normalizeRoom("A201教室"));
});

test("partial overlap reports every reason, and back-to-back lessons stay clear", () => {
  const existing = lesson();
  const overlapping = findScheduleConflicts({
    ...baseSlot,
    teacherId: "teacher-a",
    classGroupId: "class-a",
    location: " a201 ",
    studentIds: ["student-1"],
    startAt: at("2026-10-25T09:00:00.000Z"),
    endAt: at("2026-10-25T10:00:00.000Z"),
  }, [existing]);
  assert.deepEqual(overlapping.map((item) => item.kind), ["teacher", "class", "room", "student"]);

  const touching = findScheduleConflicts({
    ...baseSlot,
    teacherId: "teacher-a",
    classGroupId: "class-a",
    location: "A201",
    studentIds: ["student-1"],
    startAt: at("2026-10-25T09:30:00.000Z"),
    endAt: at("2026-10-25T11:00:00.000Z"),
  }, [existing]);
  assert.equal(touching.length, 0);
});

test("parallel classes of the same course do not conflict when teacher, room, and students differ", () => {
  const conflicts = findScheduleConflicts(baseSlot, [lesson()]);
  assert.equal(conflicts.length, 0);
});

test("overnight lessons use the full start and end", () => {
  const conflicts = findScheduleConflicts({
    ...baseSlot,
    teacherId: "teacher-a",
    startAt: at("2026-10-25T15:00:00.000Z"),
    endAt: at("2026-10-25T17:00:00.000Z"),
  }, [lesson({ startAt: at("2026-10-25T16:30:00.000Z"), endAt: at("2026-10-25T18:00:00.000Z") })]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0]?.kind, "teacher");
});

test("an empty room does not match another empty room", () => {
  const conflicts = findScheduleConflicts({ ...baseSlot, location: "  " }, [lesson({ location: null })]);
  assert.equal(conflicts.length, 0);
});

test("teacher changes can ask for the teacher reason only", () => {
  const conflicts = findScheduleConflicts({
    ...baseSlot,
    teacherId: "teacher-a",
    classGroupId: "class-a",
    location: "A201",
    studentIds: ["student-1"],
  }, [lesson()], ["teacher"]);
  assert.deepEqual(conflicts.map((item) => item.kind), ["teacher"]);
});

test("warnings list every conflict and recurring skips name the day", () => {
  const conflicts = findScheduleConflicts({
    ...baseSlot,
    teacherId: "teacher-a",
    location: "A201",
    studentIds: ["student-1"],
  }, [lesson()]);
  const warning = singleConflictWarning(conflicts, when, "再次点击保存仍会继续，请确认是否冲突。");
  assert.match(warning, /这位教师在/);
  assert.match(warning, /教室 A201 在/);
  assert.match(warning, /学生郑一鸣（STU-0010）在/);
  assert.match(warning, /再次点击保存仍会继续/);

  const message = recurringConflictMessage(2, [{ date: "2026-10-25", conflicts }], (date) => date);
  assert.match(message, /已生成 2 节课/);
  assert.match(message, /2026-10-25：教师与「已有课」重叠；教室 A201 与「已有课」重叠；学生郑一鸣（STU-0010）与「已有课」重叠。/);

  const none = recurringConflictMessage(0, [{ date: "2026-10-25", conflicts: conflicts.slice(0, 1) }], (date) => date);
  assert.match(none, /没有生成课次/);
});

test("the same classroom conflicts even when the saved place text differs", () => {
  const conflicts = findScheduleConflicts({
    ...baseSlot,
    classroomId: "room-1",
    location: "钢琴教室",
  }, [lesson({ classroomId: "room-1", location: "旧地点", teacherId: "teacher-c", classGroupId: "class-c", students: [] })]);
  assert.equal(conflicts.some((item) => item.kind === "room"), true);
});

test("room capacity warns only when the roster is larger than the seats", () => {
  assert.equal(roomCapacityWarning(8, 8, "A201"), "");
  assert.equal(roomCapacityWarning(9, 8, "A201"), "这节课有 9 人，教室「A201」可坐 8 人。");
  assert.equal(samePlaceText(" A11 ", "a11"), true);
  assert.equal(samePlaceText("A11", "B-试听"), false);
});

test("two classrooms stay distinct even when the saved place text matches", () => {
  const conflicts = findScheduleConflicts({
    ...baseSlot,
    classroomId: "room-2",
    location: "A201",
  }, [lesson({ classroomId: "room-1", location: "A201", teacherId: "teacher-c", classGroupId: "class-c", students: [] })]);
  assert.equal(conflicts.some((item) => item.kind === "room"), false);
});

test("a classroom still matches an older lesson that only has the same place text", () => {
  const conflicts = findScheduleConflicts({
    ...baseSlot,
    classroomId: "room-2",
    location: "A201",
  }, [lesson({ classroomId: null, location: "A201", teacherId: "teacher-c", classGroupId: "class-c", students: [] })]);
  assert.equal(conflicts.some((item) => item.kind === "room"), true);
});

test("two different classrooms do not conflict by room", () => {
  const conflicts = findScheduleConflicts({
    ...baseSlot,
    classroomId: "room-2",
    location: "美术教室",
  }, [lesson({ classroomId: "room-1", location: "钢琴教室", teacherId: "teacher-c", classGroupId: "class-c", students: [] })]);
  assert.equal(conflicts.some((item) => item.kind === "room"), false);
});
