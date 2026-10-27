"use client";

export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white">
      {label}
    </button>
  );
}
