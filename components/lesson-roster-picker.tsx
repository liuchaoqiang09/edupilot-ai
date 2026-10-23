"use client";

import { useEffect, useRef, useState } from "react";
import { loadClassRoster, searchOtherStudents } from "@/app/owner/schedule/actions";
import { FieldError } from "@/components/form-fields";
import { studentFacts, unenrolledBadgeClass } from "@/lib/student-profile";
import type { RosterStudent } from "@/lib/roster-student";

export function LessonRosterPicker({
  classGroupId,
  selectedIds,
  onChange,
  error,
}: {
  classGroupId: string;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  error?: string;
}) {
  const [mode, setMode] = useState<"class" | "other">("class");
  const [query, setQuery] = useState("");
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [rosterError, setRosterError] = useState("");
  const [results, setResults] = useState<RosterStudent[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const onChangeRef = useRef(onChange);
  const editedRef = useRef(false);
  onChangeRef.current = onChange;

  useEffect(() => {
    let cancelled = false;
    editedRef.current = false;
    setMode("class");
    setQuery("");
    setResults([]);
    setSearchError("");
    setRoster([]);
    setRosterError("");
    if (!classGroupId) {
      onChangeRef.current([]);
      return;
    }
    setLoadingRoster(true);
    loadClassRoster(classGroupId).then((rows) => {
      if (cancelled) return;
      setRoster(rows);
      if (!editedRef.current) onChangeRef.current(rows.map((student) => student.id));
    }).catch(() => {
      if (!cancelled) setRosterError("本班名单没有加载出来，请关闭后重新打开。");
    }).finally(() => {
      if (!cancelled) setLoadingRoster(false);
    });
    return () => {
      cancelled = true;
    };
  }, [classGroupId]);

  useEffect(() => {
    if (mode !== "other") return;
    const keyword = query.trim();
    if (!classGroupId || keyword.length === 0) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
      setSearchError("");
      searchOtherStudents(classGroupId, keyword).then((rows) => {
        if (!cancelled) setResults(rows);
      }).catch(() => {
        if (!cancelled) setSearchError("查找没有完成，请再试一次。");
      }).finally(() => {
        if (!cancelled) setSearching(false);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mode, query, classGroupId]);

  const visible = mode === "class" ? roster : results;
  const visibleIds = new Set(visible.map((student) => student.id));
  const namedInClass = mode === "other" && query.trim()
    ? roster.filter((student) => student.name.includes(query.trim()))
    : [];

  function changeSelection(ids: string[]) {
    editedRef.current = true;
    onChange(ids);
  }

  function toggle(id: string, checked: boolean) {
    changeSelection(checked ? [...new Set([...selectedIds, id])] : selectedIds.filter((current) => current !== id));
  }

  return (
    <fieldset className="grid gap-2">
      <legend className="text-xs font-bold">参加学生</legend>
      {selectedIds.map((id) => <input key={id} type="hidden" name="studentIds" value={id} />)}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode("class")}
          className={`rounded-full px-3 py-1.5 text-xs font-bold ${mode === "class" ? "bg-[var(--teal)] text-white" : "border border-[var(--line)] bg-white text-[#385058]"}`}
        >
          本班学生
        </button>
        <button
          type="button"
          onClick={() => setMode("other")}
          className={`rounded-full px-3 py-1.5 text-xs font-bold ${mode === "other" ? "bg-[var(--teal)] text-white" : "border border-[var(--line)] bg-white text-[#385058]"}`}
        >
          其他学生
        </button>
      </div>
      <p className="text-xs leading-6 text-[var(--muted)]">
        {mode === "class"
          ? "默认只列出这个班的在读学生，并已全部勾选。今天请假的人取消勾选即可。"
          : "输入姓名，从全机构在读学生里查找临时补课的人。"}
      </p>
      {mode === "other" ? (
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索学生姓名"
          className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]"
        />
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={visible.length === 0}
          onClick={() => changeSelection([...new Set([...selectedIds, ...visible.map((student) => student.id)])])}
          className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold disabled:opacity-50"
        >
          全选
        </button>
        <button
          type="button"
          disabled={visible.length === 0}
          onClick={() => changeSelection(selectedIds.filter((id) => !visibleIds.has(id)))}
          className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold disabled:opacity-50"
        >
          取消全选
        </button>
      </div>
      <div className="h-[300px] space-y-2 overflow-y-auto rounded-xl border border-[var(--line)] p-3">
        {mode === "class" && loadingRoster ? <p className="text-xs text-[var(--muted)]">正在读取本班报名学生…</p> : null}
        {mode === "class" && rosterError ? <p className="text-xs text-[#b94d4d]">{rosterError}</p> : null}
        {mode === "class" && !loadingRoster && !rosterError && roster.length === 0 ? <p className="text-xs text-[var(--muted)]">这个班还没有在读报名学生。可以切换到「其他学生」按姓名查找。</p> : null}
        {mode === "other" && query.trim().length === 0 ? <p className="text-xs text-[var(--muted)]">输入姓名后再显示结果，不会把全机构学生都列出来。</p> : null}
        {mode === "other" && searching ? <p className="text-xs text-[var(--muted)]">正在查找…</p> : null}
        {mode === "other" && searchError ? <p className="text-xs text-[#b94d4d]">{searchError}</p> : null}
        {mode === "other" && query.trim() && !searching && !searchError && results.length === 0 ? (
          <p className="text-xs text-[var(--muted)]">
            {namedInClass.length > 0 ? `${namedInClass.map((student) => student.name).join("、")}已在本班名单里。` : "没有找到其他在读学生。"}
          </p>
        ) : null}
        {visible.map((student) => (
          <label key={student.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selectedIds.includes(student.id)}
              onChange={(event) => toggle(student.id, event.target.checked)}
              className="accent-[var(--teal)]"
            />
            <span className="font-bold">{student.name}</span>
            <span className="text-xs text-[var(--muted)]">{studentFacts(student.grade, student.age)}</span>
            <span className={`ml-auto text-xs font-bold ${student.enrollmentLabel === "未报名" ? unenrolledBadgeClass + " rounded-full px-2 py-1" : "text-[#385058]"}`}>{student.enrollmentLabel}</span>
          </label>
        ))}
      </div>
      <FieldError message={error} />
    </fieldset>
  );
}
