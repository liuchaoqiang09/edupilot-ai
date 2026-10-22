import { shiftDate } from "@/lib/datetime";

const weekdayIndex = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as const;

export function shanghaiWeekday(dateKey: string) {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", weekday: "short" }).format(
    new Date(`${dateKey}T12:00:00+08:00`),
  );
  return weekdayIndex[weekday as keyof typeof weekdayIndex] ?? null;
}

export function recurringDates(start: string, end: string, weekdays: number[], skipWeekends: boolean) {
  const selected = new Set(weekdays);
  const dates: string[] = [];
  let cursor = start;
  let steps = 0;
  while (cursor <= end && steps < 400) {
    const day = shanghaiWeekday(cursor);
    const weekend = day === 0 || day === 6;
    if (day !== null && selected.has(day) && !(skipWeekends && weekend)) dates.push(cursor);
    cursor = shiftDate(cursor, 1);
    steps += 1;
  }
  return { dates, truncated: cursor <= end };
}
