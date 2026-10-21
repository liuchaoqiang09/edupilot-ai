const SHANGHAI = "Asia/Shanghai";

export function shanghaiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function shiftDate(dateKey: string, days: number) {
  const noon = new Date(`${dateKey}T12:00:00+08:00`);
  if (Number.isNaN(noon.getTime())) return shanghaiDateKey();
  return shanghaiDateKey(new Date(noon.getTime() + days * 24 * 60 * 60 * 1000));
}

export function parseDateKey(value: string | undefined) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return shanghaiDateKey();
}

export function dayRange(dateKey: string) {
  const start = new Date(`${dateKey}T00:00:00+08:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export function parseShanghaiDateTime(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00+08:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatClock(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: SHANGHAI,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: SHANGHAI,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function shanghaiWeekRange(date = new Date()) {
  const key = shanghaiDateKey(date);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: SHANGHAI, weekday: "short" }).format(
    new Date(`${key}T12:00:00+08:00`),
  );
  const index = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[weekday] ?? 1;
  const startKey = shiftDate(key, index === 0 ? -6 : 1 - index);
  const start = new Date(`${startKey}T00:00:00+08:00`);
  return { start, end: new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000) };
}

export function formatDateLabel(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00+08:00`);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: SHANGHAI,
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
}
