export const seatLabel = {
  ENROLLED: "本班",
  GUEST: "临时",
  TRIAL: "试听",
  CONVERTED: "已转正",
} as const;

export type LessonSeatName = keyof typeof seatLabel;

export function isLessonSeat(value: string): value is LessonSeatName {
  return value in seatLabel;
}

export function makeupLabel(sourceStart: Date) {
  const parts = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric" }).formatToParts(sourceStart);
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  return `补 ${month}月${day}日的请假`;
}
