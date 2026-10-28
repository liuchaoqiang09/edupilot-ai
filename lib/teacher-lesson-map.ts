import { formatCourseUsage } from "@/lib/billing-list";
import { calendarDateKey, periodValidity } from "@/lib/course-hours";
import { formatClock, formatDateLabel, formatMonthDay, shanghaiDateKey, shanghaiMinutes } from "@/lib/datetime";
import { makeupLabel, seatLabel } from "@/lib/lesson-seat";
import type { TeacherLesson } from "@/components/teacher-schedule";

type RawLesson = {
  id: string;
  title: string | null;
  startAt: Date;
  endAt: Date;
  location: string | null;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED";
  courseId: string;
  course: { id: string; name: string; billingType: "PER_LESSON" | "PER_PERIOD" };
  classGroup: { capacity: number | null; name: string };
  classroom: { name: string; capacity: number | null } | null;
  teacher: { name: string };
  students: Array<{
    id: string;
    studentId: string;
    attendanceStatus: "NOT_MARKED" | "PRESENT" | "ABSENT" | "LATE" | "LEAVE";
    leaveKind: "PERSONAL" | "SICK" | null;
    attendanceNote: string | null;
    parentLeaveAt: Date | null;
    seat: "ENROLLED" | "GUEST" | "TRIAL" | "CONVERTED";
    student: { name: string; status: string; archiveReason: string | null; guardianPhone: string | null };
    makeupSource: { lessonSession: { startAt: Date } } | null;
    makeups: { id: string }[];
  }>;
};

export function mapTeacherLessons(
  lessons: RawLesson[],
  input: {
    today: string;
    now: Date;
    hoursLeft: Map<string, number>;
    enrolledKeys: Set<string>;
    windows: Map<string, { start: string; end: string }[]>;
    pendingByLesson?: Map<string, { id: string; kind: string; startAt: Date | null; endAt: Date | null; substituteTeacher: { name: string } | null }>;
  },
): TeacherLesson[] {
  function usageText(studentId: string, courseId: string, billingType: "PER_LESSON" | "PER_PERIOD") {
    const key = `${studentId}:${courseId}`;
    const enrolled = input.enrolledKeys.has(key);
    if (billingType === "PER_PERIOD") {
      const period = periodValidity(input.windows.get(key) ?? [], input.today);
      return formatCourseUsage({
        enrolled,
        billingType,
        periodStatus: enrolled ? period.status : null,
        remainingHours: null,
        validUntil: period.end === "—" ? null : period.end,
      }, input.today);
    }
    return formatCourseUsage({
      enrolled,
      billingType,
      periodStatus: null,
      remainingHours: enrolled ? input.hoursLeft.get(key) ?? 0 : null,
      validUntil: null,
    }, input.today);
  }

  return lessons.map((lesson) => {
    const startMinutes = shanghaiMinutes(lesson.startAt);
    const endMinutes = shanghaiMinutes(lesson.endAt);
    const pending = input.pendingByLesson?.get(lesson.id);
    return {
      id: lesson.id,
      title: lesson.title ?? "课次",
      dateKey: shanghaiDateKey(lesson.startAt),
      dateLabel: formatMonthDay(shanghaiDateKey(lesson.startAt)),
      startLabel: formatClock(lesson.startAt),
      endLabel: formatClock(lesson.endAt),
      startMinutes,
      endMinutes: endMinutes > startMinutes ? endMinutes : startMinutes + 60,
      courseId: lesson.courseId,
      courseName: lesson.course.name,
      billingType: lesson.course.billingType,
      canEditRoster: lesson.status !== "CANCELLED" && lesson.startAt > input.now,
      canRequestChange: lesson.status !== "CANCELLED" && lesson.startAt > input.now,
      changeRequest: pending
        ? {
            id: pending.id,
            summary: pending.kind === "RESCHEDULE" && pending.startAt && pending.endAt
              ? `调课待同意：改到 ${formatDateLabel(shanghaiDateKey(pending.startAt))} ${formatClock(pending.startAt)}–${formatClock(pending.endAt)}`
              : `代课待同意：${pending.substituteTeacher?.name ?? "另一位教师"}`,
          }
        : null,
      teacherName: lesson.teacher.name,
      location: lesson.classroom?.name || lesson.location,
      status: lesson.status,
      classCapacity: lesson.classGroup.capacity,
      className: lesson.classGroup.name,
      roomCapacity: lesson.classroom?.capacity ?? null,
      overClassCapacity: lesson.classGroup.capacity != null && lesson.students.length > lesson.classGroup.capacity,
      overRoomCapacity: lesson.classroom?.capacity != null && lesson.students.length > lesson.classroom.capacity,
      students: lesson.students.map((row) => ({
        id: row.studentId,
        lessonStudentId: row.id,
        name: row.student.name,
        phone: row.student.guardianPhone,
        inactive: row.student.status !== "ACTIVE",
        archiveReason: row.student.archiveReason,
        attendanceStatus: row.attendanceStatus,
        leaveKind: row.leaveKind,
        attendanceNote: row.attendanceNote,
        parentLeave: row.parentLeaveAt != null,
        seat: row.seat,
        seatLabel: seatLabel[row.seat],
        makeupText: row.makeupSource ? makeupLabel(row.makeupSource.lessonSession.startAt) : null,
        usageText: usageText(row.studentId, lesson.courseId, lesson.course.billingType),
        canMakeup: lesson.status !== "CANCELLED" && row.attendanceStatus === "LEAVE" && row.makeups.length === 0 && row.student.status === "ACTIVE",
      })),
    };
  });
}

export function attendanceProgress(lesson: TeacherLesson) {
  const active = lesson.students.filter((student) => !student.inactive);
  const unmarked = active.filter((student) => student.attendanceStatus === "NOT_MARKED").length;
  const present = active.filter((student) => student.attendanceStatus === "PRESENT" || student.attendanceStatus === "LATE").length;
  const absent = active.filter((student) => student.attendanceStatus === "ABSENT").length;
  const leave = active.filter((student) => student.attendanceStatus === "LEAVE").length;
  return { total: active.length, unmarked, present, absent, leave, done: active.length - unmarked };
}
