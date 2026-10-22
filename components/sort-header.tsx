"use client";

import Link from "next/link";
import type { SortOrder } from "@/lib/table-sort";

export function SortHeader({
  label,
  field,
  sortBy,
  order,
  pathname,
  query,
  extra,
}: {
  label: string;
  field: string;
  sortBy: string | null;
  order: SortOrder | null;
  pathname: string;
  query?: string;
  extra?: Record<string, string>;
}) {
  const active = sortBy === field;
  const nextOrder = !active ? "asc" : order === "asc" ? "desc" : null;
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value) params.set(key, value);
  }
  if (nextOrder) {
    params.set("sortBy", field);
    params.set("order", nextOrder);
  }
  const href = params.size > 0 ? `${pathname}?${params}` : pathname;
  const mark = active && order === "asc" ? "↑" : active && order === "desc" ? "↓" : "↕";
  const title = !active ? `按${label}升序` : order === "asc" ? `按${label}降序` : `恢复${label}默认顺序`;

  return (
    <th className="px-4 py-3 font-extrabold" aria-sort={active ? (order === "asc" ? "ascending" : "descending") : "none"}>
      <Link href={href} title={title} className="inline-flex items-center gap-1 text-inherit">
        {label}
        <span aria-hidden="true">{mark}</span>
      </Link>
    </th>
  );
}
