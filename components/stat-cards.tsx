import Link from "next/link";

export function StatCards({
  items,
}: {
  items: { label: string; value: number; hint: string; href: string; warn?: boolean; live?: boolean }[];
}) {
  return (
    <div className="ws-stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <Link key={item.label} href={item.href} className="ws-card ws-enter block cursor-pointer rounded-2xl border p-4">
          <div className="flex items-center justify-between gap-2 text-xs font-bold text-[var(--muted)]">
            <span className="inline-flex items-center gap-1.5">
              {item.live ? <span className="ws-live-dot" aria-hidden /> : null}
              {item.warn ? <span className="ws-live-dot ws-live-dot--amber" aria-hidden /> : null}
              {item.label}
            </span>
            <span className="ws-stat-icon grid h-7 w-7 place-items-center rounded-[9px] text-[11px]">◆</span>
          </div>
          <div className="ws-value mt-2 text-3xl font-semibold tracking-tight">{item.value}</div>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{item.hint}</p>
        </Link>
      ))}
    </div>
  );
}
