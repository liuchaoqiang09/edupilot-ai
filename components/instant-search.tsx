"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { usePick } from "@/components/locale-provider";

const waitMs = 300;

export function InstantSearch({
  action,
  query,
  placeholder,
  params,
  className,
  inputClassName,
  resetLabel = "重置",
}: {
  action: string;
  query: string;
  placeholder: string;
  params?: Record<string, string | null | undefined>;
  className?: string;
  inputClassName: string;
  resetLabel?: string;
}) {
  const router = useRouter();
  const t = usePick();
  const [value, setValue] = useState(query);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    setValue(query);
  }, [query]);

  useEffect(() => () => {
    if (timer.current != null) window.clearTimeout(timer.current);
  }, []);

  function href(next: string) {
    const search = new URLSearchParams();
    for (const [key, item] of Object.entries(params ?? {})) {
      if (item) search.set(key, item);
    }
    const text = next.trim();
    if (text) search.set("q", text);
    const suffix = search.toString();
    return suffix ? `${action}?${suffix}` : action;
  }

  function go(next: string) {
    const target = href(next);
    const current = `${window.location.pathname}${window.location.search}`;
    if (target === current) return;
    router.replace(target, { scroll: false });
  }

  function schedule(next: string) {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => go(next), waitMs);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (timer.current != null) window.clearTimeout(timer.current);
    go(value);
  }

  return (
    <form action={action} onSubmit={submit} className={className}>
      {Object.entries(params ?? {}).map(([key, item]) => (item ? <input key={key} type="hidden" name={key} value={item} /> : null))}
      <input
        name="q"
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          schedule(next);
        }}
        className={inputClassName}
      />
      <button className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold text-[#385058]">{t("搜索", "Search")}</button>
      {query ? (
        <Link href={href("")} className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold text-[#385058]">
          {resetLabel === "重置" ? t("重置", "Reset") : resetLabel}
        </Link>
      ) : null}
    </form>
  );
}
