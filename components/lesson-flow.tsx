import Link from "next/link";

export function LessonFlow({ lessonId, dateKey, current }: { lessonId: string; dateKey: string; current: "attendance" | "record" }) {
  const attendance = `/teacher/attendance?tab=day&date=${dateKey}&lesson=${lessonId}`;
  const record = `/teacher/records?lesson=${lessonId}`;
  const steps = [
    { id: "attendance" as const, label: "1 学生签到", href: attendance },
    { id: "record" as const, label: "2 记录与点评", href: record },
  ];
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {steps.map((step) => (
        <Link key={step.id} href={step.href} className={`rounded-full px-3 py-1.5 text-xs font-bold ${step.id === current ? "bg-[var(--navy)] text-white" : "border border-[var(--line)] bg-white text-[var(--ink)]"}`}>
          {step.label}
        </Link>
      ))}
    </div>
  );
}
