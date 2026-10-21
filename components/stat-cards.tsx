import Link from "next/link";

export function StatCards({
  items,
}: {
  items: { label: string; value: number; hint: string; href: string }[];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <Link key={item.label} href={item.href} className="rounded-2xl border border-[var(--line)] bg-white p-4 hover:border-[var(--teal)]">
          <div className="text-xs font-bold text-[var(--muted)]">{item.label}</div>
          <div className="mt-2 text-3xl font-semibold tracking-tight">{item.value}</div>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{item.hint}</p>
        </Link>
      ))}
    </div>
  );
}
