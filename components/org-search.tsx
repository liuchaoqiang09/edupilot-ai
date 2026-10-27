"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Hit = { id: string; name: string; studentNo: string | null; guardianPhone: string | null };

export function OrgSearch() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const keyword = query.trim();
    if (keyword.length < 1) {
      setHits([]);
      return;
    }
    const timer = setTimeout(() => {
      fetch(`/api/owner/search?q=${encodeURIComponent(keyword)}`)
        .then((response) => response.ok ? response.json() : [])
        .then((rows: Hit[]) => { setHits(rows); setOpen(true); })
        .catch(() => setHits([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="relative hidden md:block">
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => setOpen(true)}
        placeholder="搜索学生姓名、编号或电话"
        className="w-56 rounded-full border border-[var(--line)] bg-white px-3 py-2 text-xs outline-none focus:border-[var(--teal)] lg:w-72"
      />
      {open && query.trim() && hits.length > 0 ? (
        <ul className="absolute left-0 top-10 z-30 w-72 overflow-hidden rounded-xl border border-[var(--line)] bg-white shadow-[0_14px_36px_rgba(24,42,53,.07)]">
          {hits.map((hit) => (
            <li key={hit.id}>
              <Link
                href={`/owner/students?student=${hit.id}`}
                className="block px-3 py-2 text-xs hover:bg-[#f7faf8]"
              >
                <strong>{hit.name}</strong>
                <span className="ml-2 text-[var(--muted)]">{hit.studentNo ?? "未编号"}{hit.guardianPhone ? ` · ${hit.guardianPhone}` : ""}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {open && query.trim() && hits.length === 0 ? (
        <p className="absolute left-0 top-10 z-30 w-72 rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-xs text-[var(--muted)]">没有找到本机构的学生。</p>
      ) : null}
    </div>
  );
}
