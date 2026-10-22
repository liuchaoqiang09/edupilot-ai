"use client";

import { coursePalette } from "@/lib/course-colors";

export type WeekCard = {
  id: string;
  dateKey: string;
  dateLabel: string;
  startLabel: string;
  startMinutes: number;
  endMinutes: number;
  courseId: string;
  courseName: string;
  teacherName: string;
  location: string | null;
  status: string;
};

const dayStart = 8 * 60;
const dayEnd = 22 * 60;
const slotHeight = 48;

function clock(minutes: number) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function WeekGrid<T extends WeekCard>({
  slotMinutes,
  days,
  lessons,
  onOpen,
}: {
  slotMinutes: 30 | 45 | 60;
  days: { key: string; weekday: string; dateLabel: string }[];
  lessons: T[];
  onOpen: (lesson: T) => void;
}) {
  const ticks: number[] = [];
  for (let minute = dayStart; minute < dayEnd; minute += slotMinutes) ticks.push(minute);
  const totalHeight = ((dayEnd - dayStart) / slotMinutes) * slotHeight;
  const outside = lessons.filter((lesson) => lesson.startMinutes < dayStart || lesson.startMinutes >= dayEnd);
  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
      {outside.length > 0 ? (
        <div className="border-b border-[var(--line)] px-4 py-3">
          <p className="text-[11px] font-bold text-[var(--muted)]">08:00 前或 22:00 后</p>
          <div className="mt-2 flex gap-2 overflow-x-auto">
            {outside.map((lesson) => {
              const palette = coursePalette(lesson.courseId);
              return (
              <button key={lesson.id} type="button" onClick={() => onOpen(lesson)} className="min-w-[180px] rounded-xl border px-3 py-2 text-left" style={{ background: palette.background, borderColor: palette.border, borderLeftWidth: 4, borderLeftColor: palette.accent }}>
                <div className="text-[11px] font-bold">{lesson.dateLabel} {lesson.startLabel}</div>
                <div className="mt-1 flex items-center gap-1.5 text-xs font-bold"><span className="h-2 w-2 rounded-full" style={{ background: palette.accent }} />{lesson.courseName}</div>
                <div className="text-[11px] text-[var(--muted)]">{lesson.teacherName} · {lesson.location ?? "地点待定"}</div>
              </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <div className="min-w-[840px]">
          <div className="grid grid-cols-[72px_repeat(7,minmax(0,1fr))] border-b border-[var(--line)] bg-[#fafbf9]">
            <div />
            {days.map((day) => (
              <div key={day.key} className="border-l border-[var(--line)] px-2 py-3 text-center">
                <div className="text-xs font-extrabold">{day.weekday}</div>
                <div className="mt-1 text-[11px] text-[var(--muted)]">{day.dateLabel}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-[72px_repeat(7,minmax(0,1fr))]">
            <div className="relative" style={{ height: totalHeight }}>
              {ticks.map((minute) => (
                <div key={minute} className="absolute right-2 text-[10px] text-[var(--muted)]" style={{ top: ((minute - dayStart) / slotMinutes) * slotHeight }}>
                  {clock(minute)}
                </div>
              ))}
              <div className="absolute right-2 text-[10px] text-[var(--muted)]" style={{ top: totalHeight - 14 }}>{clock(dayEnd)}</div>
            </div>
            {days.map((day) => {
              const cards = layout(lessons.filter((lesson) => lesson.dateKey === day.key && lesson.startMinutes < dayEnd && lesson.endMinutes > dayStart));
              return (
                <div key={day.key} className="relative border-l border-[var(--line)]" style={{ height: totalHeight }}>
                  {ticks.map((minute) => (
                    <div key={minute} className="absolute inset-x-0 border-b border-[#f0f2f0]" style={{ top: ((minute - dayStart) / slotMinutes) * slotHeight }} />
                  ))}
                  {cards.map(({ lesson, lane, laneCount }) => {
                    const palette = coursePalette(lesson.courseId);
                    const start = Math.max(lesson.startMinutes, dayStart);
                    const end = Math.min(lesson.endMinutes, dayEnd);
                    const top = ((start - dayStart) / slotMinutes) * slotHeight;
                    const height = Math.max(24, ((end - start) / slotMinutes) * slotHeight - 4);
                    const width = `calc(${100 / laneCount}% - 6px)`;
                    const left = `calc(${(100 / laneCount) * lane}% + 3px)`;
                    return (
                      <button
                        key={lesson.id}
                        type="button"
                        onClick={() => onOpen(lesson)}
                        className={`absolute overflow-hidden rounded-lg border px-1.5 py-1 text-left text-[#17343a] ${lesson.status === "CANCELLED" ? "opacity-60" : ""}`}
                        style={{ top, height, width, left, background: palette.background, borderColor: palette.border, borderLeftWidth: 4, borderLeftColor: palette.accent }}
                      >
                        <div className="flex items-center gap-1 truncate text-[11px] font-extrabold"><span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: palette.accent }} />{lesson.courseName}</div>
                        <div className="truncate text-[10px]">{lesson.teacherName}</div>
                        <div className="truncate text-[10px] opacity-70">{lesson.location ?? "地点待定"}</div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function layout<T extends WeekCard>(lessons: T[]) {
  const sorted = [...lessons].sort((left, right) => left.startMinutes - right.startMinutes || left.endMinutes - right.endMinutes);
  const laneEnds: number[] = [];
  const placed = sorted.map((lesson) => {
    let lane = laneEnds.findIndex((end) => end <= lesson.startMinutes);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(lesson.endMinutes);
    } else {
      laneEnds[lane] = lesson.endMinutes;
    }
    return { lesson, lane };
  });
  const laneCount = Math.max(1, laneEnds.length);
  return placed.map((item) => ({ ...item, laneCount }));
}
