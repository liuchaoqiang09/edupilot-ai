export const lessonStatusLabel = {
  SCHEDULED: "已排课",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
} as const;

/** 底层考勤状态标签（请假总称；展示事假/病假请用 leave-kind）。 */
export const attendanceLabel = {
  NOT_MARKED: "未标记",
  PRESENT: "出勤",
  ABSENT: "缺勤",
  LATE: "迟到",
  LEAVE: "请假",
} as const;

export const attendanceOptions = ["NOT_MARKED", "PRESENT", "ABSENT", "LATE", "LEAVE"] as const;
