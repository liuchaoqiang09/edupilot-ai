"use client";

import { useMemo, useState } from "react";
import { studentFacts } from "@/lib/student-profile";

export type DirectoryStudent = {
  id: string;
  name: string;
  studentNo: string | null;
  grade: string | null;
  age: number | null;
  classNames: string[];
  phones: string[];
  guardianName?: string | null;
};

function matchesStudent(student: DirectoryStudent, query: string) {
  const text = query.trim().toLowerCase();
  if (!text) return true;
  if (student.name.toLowerCase().includes(text)) return true;
  if ((student.studentNo ?? "").toLowerCase().includes(text)) return true;
  if ((student.grade ?? "").toLowerCase().includes(text)) return true;
  if (student.age && String(student.age) === text) return true;
  const digits = text.replace(/\D/g, "");
  return student.phones.some((phone) => phone.toLowerCase().includes(text) || (digits.length > 0 && phone.includes(digits)));
}

export function StudentCombobox({
  students,
  value,
  onChange,
}: {
  students: DirectoryStudent[];
  value: string;
  onChange: (studentId: string) => void;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [listOpen, setListOpen] = useState(true);
  const selected = students.find((student) => student.id === value) ?? null;
  const matches = useMemo(() => students.filter((student) => matchesStudent(student, query)), [students, query]);
  const selectedText = selected
    ? `${selected.name}（${selected.studentNo ?? "未编号"}，${studentFacts(selected.grade, selected.age)}）`
    : "请选择学员";

  return (
    <div className="overflow-hidden rounded-[10px] border border-[var(--line)] bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] bg-[#f7faf8] px-3 py-2.5">
        <span className={`min-w-0 truncate text-sm font-semibold ${selected ? "text-[#182a35]" : "text-[var(--muted)]"}`}>{selectedText}</span>
        <button
          type="button"
          aria-expanded={listOpen}
          aria-label={listOpen ? "隐藏学生名单" : "显示学生名单"}
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
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索姓名、编号或手机号"
          autoComplete="off"
          aria-label="搜索学员"
          className="w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm font-medium outline-none focus:border-[var(--teal)]"
        />
      </div>
      {listOpen ? <ul role="listbox" aria-label="学员列表" className="max-h-52 overflow-y-auto">
        {matches.length === 0 ? (
          <li className="px-3 py-3 text-xs font-medium text-[var(--muted)]">没有匹配的学员</li>
        ) : matches.map((student) => {
          const chosen = student.id === value;
          return (
            <li key={student.id}>
              <button
                type="button"
                role="option"
                aria-selected={chosen}
                onClick={() => onChange(student.id)}
                className={`grid w-full grid-cols-[minmax(0,1fr)_88px_minmax(52px,0.7fr)_44px] items-center gap-2 px-3 py-2.5 text-left text-sm ${chosen ? "bg-[#e4f2ee] font-bold text-[#146b62]" : "font-medium text-[#182a35] hover:bg-[#f7faf8]"}`}
              >
                <span className="truncate">{student.name}</span>
                <span className="font-bold">{student.studentNo ?? "未编号"}</span>
                <span className={`truncate ${chosen ? "text-[#146b62]" : "text-[var(--muted)]"}`}>{student.grade ?? "未填年级"}</span>
                <span className={chosen ? "text-[#146b62]" : "text-[var(--muted)]"}>{student.age ? `${student.age}岁` : "—"}</span>
              </button>
            </li>
          );
        })}
      </ul> : null}
    </div>
  );
}
