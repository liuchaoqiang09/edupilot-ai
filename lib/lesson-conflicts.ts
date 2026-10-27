export type ConflictKind = "teacher" | "class" | "room" | "student";

export type ExistingLesson = {
  id: string;
  title: string | null;
  startAt: Date;
  endAt: Date;
  teacherId: string;
  classGroupId: string;
  location: string | null;
  classroomId: string | null;
  students: { id: string; name: string; studentNo: string | null }[];
};

export type ScheduleConflict = {
  kind: ConflictKind;
  lessonTitle: string;
  startAt: Date;
  room?: string;
  studentName?: string;
  studentNo?: string | null;
};

const kindOrder: Record<ConflictKind, number> = { teacher: 0, class: 1, room: 2, student: 3 };

export function normalizeRoom(value: string | null | undefined) {
  const text = value?.trim().toLowerCase() ?? "";
  return text.length > 0 ? text : null;
}

export function samePlaceText(left: string | null | undefined, right: string | null | undefined) {
  const first = normalizeRoom(left);
  const second = normalizeRoom(right);
  return Boolean(first && second && first === second);
}

export function roomCapacityWarning(studentCount: number, capacity: number, roomName: string) {
  if (studentCount <= capacity) return "";
  return `这节课有 ${studentCount} 人，教室「${roomName}」可坐 ${capacity} 人。`;
}

function lessonTitle(title: string | null) {
  return title?.trim() || "未命名课次";
}

function studentLabel(name: string, studentNo: string | null | undefined) {
  return studentNo ? `${name}（${studentNo}）` : name;
}

export function findScheduleConflicts(
  slot: {
    teacherId: string;
    classGroupId: string;
    location: string | null;
    classroomId?: string | null;
    studentIds: string[];
    startAt: Date;
    endAt: Date;
  },
  existing: ExistingLesson[],
  kinds: ConflictKind[] = ["teacher", "class", "room", "student"],
) {
  const wanted = new Set(kinds);
  const room = normalizeRoom(slot.location);
  const roomLabel = slot.location?.trim() ?? "";
  const studentIds = new Set(slot.studentIds);
  const conflicts: ScheduleConflict[] = [];
  for (const lesson of existing) {
    if (!(lesson.startAt < slot.endAt && lesson.endAt > slot.startAt)) continue;
    const title = lessonTitle(lesson.title);
    if (wanted.has("teacher") && lesson.teacherId === slot.teacherId) {
      conflicts.push({ kind: "teacher", lessonTitle: title, startAt: lesson.startAt });
    }
    if (wanted.has("class") && lesson.classGroupId === slot.classGroupId) {
      conflicts.push({ kind: "class", lessonTitle: title, startAt: lesson.startAt });
    }
    const lessonRoom = normalizeRoom(lesson.location);
    const sameClassroom = Boolean(slot.classroomId && lesson.classroomId && slot.classroomId === lesson.classroomId);
    const textOnly = !slot.classroomId || !lesson.classroomId;
    const samePlaceText = textOnly && Boolean(room && lessonRoom && room === lessonRoom);
    if (wanted.has("room") && (sameClassroom || samePlaceText)) {
      conflicts.push({ kind: "room", lessonTitle: title, startAt: lesson.startAt, room: roomLabel || lesson.location?.trim() || "教室" });
    }
    if (wanted.has("student")) {
      for (const student of lesson.students) {
        if (!studentIds.has(student.id)) continue;
        conflicts.push({
          kind: "student",
          lessonTitle: title,
          startAt: lesson.startAt,
          studentName: student.name,
          studentNo: student.studentNo,
        });
      }
    }
  }
  return conflicts.sort((left, right) =>
    kindOrder[left.kind] - kindOrder[right.kind]
    || left.startAt.getTime() - right.startAt.getTime()
    || (left.studentName ?? "").localeCompare(right.studentName ?? "", "zh"),
  );
}

export function singleConflictWarning(conflicts: ScheduleConflict[], formatWhen: (date: Date) => string, confirm: string) {
  const lines = conflicts.map((conflict) => {
    const when = formatWhen(conflict.startAt);
    if (conflict.kind === "teacher") return `这位教师在 ${when} 已有课次「${conflict.lessonTitle}」。`;
    if (conflict.kind === "class") return `这个班在 ${when} 已有课次「${conflict.lessonTitle}」。`;
    if (conflict.kind === "room") return `教室 ${conflict.room} 在 ${when} 已有课次「${conflict.lessonTitle}」。`;
    return `学生${studentLabel(conflict.studentName ?? "未命名学生", conflict.studentNo)}在 ${when} 已有课次「${conflict.lessonTitle}」。`;
  });
  return [...lines, confirm].join("\n");
}

export function recurringConflictMessage(
  created: number,
  skips: { date: string; conflicts: ScheduleConflict[] }[],
  formatDay: (dateKey: string) => string,
) {
  const listed = skips.slice(0, 12).map((skip) => {
    const reasons = skip.conflicts.map((conflict) => {
      if (conflict.kind === "teacher") return `教师与「${conflict.lessonTitle}」重叠`;
      if (conflict.kind === "class") return `这个班与「${conflict.lessonTitle}」重叠`;
      if (conflict.kind === "room") return `教室 ${conflict.room} 与「${conflict.lessonTitle}」重叠`;
      return `学生${studentLabel(conflict.studentName ?? "未命名学生", conflict.studentNo)}与「${conflict.lessonTitle}」重叠`;
    });
    return `${formatDay(skip.date)}：${reasons.join("；")}。`;
  });
  const rest = skips.length - listed.length;
  const head = created > 0 ? `已生成 ${created} 节课。以下日期因冲突跳过：` : "没有生成课次。以下日期因冲突跳过：";
  return [head, ...listed, rest > 0 ? `其余 ${rest} 天同样有冲突。` : ""].filter(Boolean).join("\n");
}
