"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export function DayStep({
  href,
  direction,
  label,
}: {
  href: string;
  direction: "back" | "forward";
  label: string;
}) {
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    if (!pressed) return;
    const timer = window.setTimeout(() => setPressed(false), 480);
    return () => window.clearTimeout(timer);
  }, [pressed]);

  const shift = pressed ? (direction === "back" ? "-translate-x-1.5" : "translate-x-1.5") : "";
  return (
    <Link
      href={href}
      aria-label={label}
      onClick={() => setPressed(true)}
      className={`inline-grid h-9 w-9 place-items-center rounded-[10px] border transition duration-200 active:scale-95 ${shift} ${pressed ? "border-[var(--teal)] bg-[var(--teal)] text-white" : "border-[var(--line)] bg-white text-[#385058]"}`}
    >
      <Chevron direction={direction} />
    </Link>
  );
}

export function useDateFlash(key: string) {
  const [flash, setFlash] = useState(false);
  const previous = useRef(key);

  useEffect(() => {
    if (previous.current === key) return;
    previous.current = key;
    setFlash(true);
    const timer = window.setTimeout(() => setFlash(false), 700);
    return () => window.clearTimeout(timer);
  }, [key]);

  return flash;
}

export function dateFlashClass(flash: boolean) {
  return flash
    ? "rounded-md bg-[var(--teal-2)] px-2 py-1 text-xs font-bold text-[var(--teal)] transition"
    : "text-xs text-[var(--muted)] transition";
}

function Chevron({ direction }: { direction: "back" | "forward" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {direction === "back" ? <path d="M10 3 5 8l5 5" /> : <path d="M6 3l5 5-5 5" />}
    </svg>
  );
}
