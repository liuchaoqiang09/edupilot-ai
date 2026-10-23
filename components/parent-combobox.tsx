"use client";

import { useMemo, useState } from "react";

export type ParentOption = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  childCount: number;
};

function accountLabel(parent: ParentOption) {
  return parent.phone ? `${parent.email} · ${parent.phone}` : parent.email;
}

function matchesParent(parent: ParentOption, query: string) {
  const text = query.trim().toLowerCase();
  if (!text) return true;
  if (parent.name.toLowerCase().includes(text)) return true;
  if (parent.email.toLowerCase().includes(text)) return true;
  const digits = text.replace(/\D/g, "");
  return Boolean(parent.phone && (parent.phone.toLowerCase().includes(text) || (digits.length > 0 && parent.phone.includes(digits))));
}

export function ParentCombobox({
  parents,
  value,
  onChange,
}: {
  parents: ParentOption[];
  value: string;
  onChange: (parentId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [listOpen, setListOpen] = useState(true);
  const selected = parents.find((parent) => parent.id === value) ?? null;
  const matches = useMemo(() => parents.filter((parent) => matchesParent(parent, query)), [parents, query]);

  return (
    <div className="overflow-hidden rounded-[10px] border border-[var(--line)] bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] bg-[#f7faf8] px-3 py-2.5">
        <span className={`min-w-0 truncate text-sm font-semibold ${selected ? "text-[#182a35]" : "text-[var(--muted)]"}`}>
          {selected ? `${selected.name} · ${accountLabel(selected)}` : "请选择本机构家长"}
        </span>
        <button
          type="button"
          aria-expanded={listOpen}
          aria-label={listOpen ? "隐藏家长名单" : "显示家长名单"}
          onClick={() => setListOpen((open) => !open)}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[#51656a] hover:bg-white"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className={`transition-transform ${listOpen ? "" : "-rotate-90"}`}>
            <path d="M3 5.2 7 9l4-3.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div className="border-b border-[var(--line)] px-2 py-2">
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setListOpen(true);
          }}
          placeholder="搜索家长姓名、账号或手机号"
          autoComplete="off"
          aria-label="搜索家长"
          className="w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm font-medium outline-none focus:border-[var(--teal)]"
        />
      </div>
      {listOpen ? (
        <ul role="listbox" aria-label="家长列表" className="max-h-52 overflow-y-auto">
          {matches.length === 0 ? (
            <li className="px-3 py-3 text-xs font-medium text-[var(--muted)]">{parents.length === 0 ? "没有可绑定的家长账号。" : "没有匹配的家长"}</li>
          ) : matches.map((parent) => {
            const chosen = parent.id === value;
            return (
              <li key={parent.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={chosen}
                  onClick={() => onChange(parent.id)}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left ${chosen ? "bg-[#e4f2ee] text-[#146b62]" : "text-[#182a35] hover:bg-[#f7faf8]"}`}
                >
                  <span className="min-w-0 truncate text-sm font-semibold">{parent.name} · {accountLabel(parent)}</span>
                  {parent.childCount > 0 ? <span className={`shrink-0 text-[11px] font-medium ${chosen ? "text-[#146b62]" : "text-[#8a9894]"}`}>已绑定 {parent.childCount} 个孩子</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
