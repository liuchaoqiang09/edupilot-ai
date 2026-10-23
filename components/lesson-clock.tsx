import { dayPartLabel } from "@/lib/datetime";

export function LessonClock({ start, end, date }: { start: string; end: string; date?: string }) {
  const part = dayPartLabel(start);
  return (
    <div>
      {date ? <span className="mb-1 block text-[11px] font-medium leading-4 text-[var(--muted)]">{date}</span> : null}
      {part ? <span className="mb-1 inline-flex rounded bg-[#eef1ee] px-1.5 py-0.5 text-[10px] font-medium leading-none text-[#74838b]">{part}</span> : null}
      <span className="block text-sm font-extrabold leading-4">{start}</span>
      <span className="mt-1 block text-[13px] font-medium leading-4 text-[var(--muted)]">{end}</span>
    </div>
  );
}
