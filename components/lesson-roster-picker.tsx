"use client";

import { useEffect, useRef, useState } from "react";
import { loadClassRoster, loadOtherStudents, searchOtherStudents } from "@/app/owner/schedule/actions";
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
  const [others, setOthers] = useState<RosterStudent[]>([]);
  const [loadingOthers, setLoadingOthers] = useState(false);
  const [othersError, setOthersError] = useState("");
  const [othersOpen, setOthersOpen] = useState(true);
  const [seats, setSeats] = useState<Record<string, "GUEST" | "TRIAL">>({});
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
    setOthers([]);
    setOthersError("");
    setOthersOpen(true);
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

  useEffect(() => {
    if (mode !== "other" || !classGroupId) return;
    let cancelled = false;
    setLoadingOthers(true);
    setOthersError("");
    loadOtherStudents(classGroupId).then((rows) => {
      if (!cancelled) setOthers(rows);
    }).catch(() => {
      if (!cancelled) setOthersError("非本班学生没有加载出来，请再试一次。");
    }).finally(() => {
      if (!cancelled) setLoadingOthers(false);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, classGroupId]);

  const dropdownIds = new Set(mode === "other" && othersOpen ? others.map((student) => student.id) : []);
  const listed = mode === "class" ? roster : results.filter((student) => !dropdownIds.has(student.id));
  const bulkTargets = mode === "class" ? roster : query.trim() ? results : others;
  const bulkIds = new Set(bulkTargets.map((student) => student.id));
  const namedInClass = mode === "other" && query.trim()
    ? roster.filter((student) => {
      const text = query.trim().toLowerCase();
      return student.name.toLowerCase().includes(text) || (student.studentNo ?? "").toLowerCase().includes(text);
    })
    : [];

  function changeSelection(ids: string[]) {
    editedRef.current = true;
    onChange(ids);
  }

  function toggle(id: string, checked: boolean) {
    changeSelection(checked ? [...new Set([...selectedIds, id])] : selectedIds.filter((current) => current !== id));
  }

  function studentRow(student: RosterStudent) {
    const unenrolled = student.enrollmentLabel === "未报名此课程" || student.enrollmentLabel === "未报名";
    const ended = student.enrollmentLabel.startsWith("已过期") || student.enrollmentLabel === "无课时" || student.enrollmentLabel === "欠费";
    const sameCourse = student.enrollmentLabel === "同课程不同班";
    return (
      <label key={student.id} className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={selectedIds.includes(student.id)}
          onChange={(event) => toggle(student.id, event.target.checked)}
          className="accent-[var(--teal)]"
        />
        <span className="min-w-0 truncate font-bold">{student.name}</span>
        <span className="shrink-0 text-xs font-bold text-[#385058]">{student.studentNo ?? "未编号"}</span>
        <span className="min-w-0 truncate text-xs text-[var(--muted)]">{studentFacts(student.grade, student.age)}</span>
        <span className={`ml-auto shrink-0 text-xs font-bold ${unenrolled ? `${unenrolledBadgeClass} rounded-full px-2 py-1` : ended ? "rounded-full bg-[#fff2df] px-2 py-1 text-[#9a6729]" : sameCourse ? "rounded-full bg-[#e4f2ee] px-2 py-1 text-[#146b62]" : "text-[#385058]"}`}>{student.enrollmentLabel}</span>
        {mode === "other" && selectedIds.includes(student.id) ? (
          <select
            value={seats[student.id] ?? "GUEST"}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setSeats((current) => ({ ...current, [student.id]: event.target.value === "TRIAL" ? "TRIAL" : "GUEST" }))}
            className="shrink-0 rounded-full border border-[var(--line)] bg-white px-2 py-1 text-xs font-bold"
          >
            <option value="GUEST">临时</option>
            <option value="TRIAL">试听</option>
          </select>
        ) : null}
      </label>
    );
  }

  return (
    <fieldset className="grid gap-2">
      <legend className="text-xs font-bold">参加学生</legend>
      {selectedIds.map((id) => <input key={id} type="hidden" name="studentIds" value={id} />)}
      {selectedIds.filter((id) => !roster.some((student) => student.id === id)).map((id) => (
        <input key={`seat-${id}`} type="hidden" name={`seat:${id}`} value={seats[id] ?? "GUEST"} />
      ))}
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
          : "输入姓名或编号查找本班以外的学生。勾选后选择「临时」或「试听」。试听不扣课时。"}
      </p>
      {mode === "other" ? (
        <div className="overflow-hidden rounded-[10px] border border-[var(--line)] bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] bg-[#f7faf8] px-3 py-2.5">
            <span className="text-xs font-bold">非本班学生</span>
            <button
              type="button"
              aria-expanded={othersOpen}
              aria-label={othersOpen ? "隐藏学生名单" : "显示学生名单"}
              onClick={() => setOthersOpen((open) => !open)}
              className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[#51656a] hover:bg-white"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className={`transition-transform ${othersOpen ? "" : "-rotate-90"}`}>
                <path d="M3 5.2 7 9l4-3.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          {othersOpen ? (
            <div className="max-h-52 space-y-2 overflow-y-auto p-3">
              {loadingOthers ? <p className="text-xs text-[var(--muted)]">正在读取非本班学生…</p> : null}
              {othersError ? <p className="text-xs text-[#b94d4d]">{othersError}</p> : null}
              {!loadingOthers && !othersError && others.length === 0 ? <p className="text-xs text-[var(--muted)]">没有本班以外的在读学生。</p> : null}
              {others.map((student) => studentRow(student))}
            </div>
          ) : null}
        </div>
      ) : null}
      {mode === "other" ? (
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索学生姓名或编号"
          className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]"
        />
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={bulkTargets.length === 0}
          onClick={() => changeSelection([...new Set([...selectedIds, ...bulkTargets.map((student) => student.id)])])}
          className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold disabled:opacity-50"
        >
          全选
        </button>
        <button
          type="button"
          disabled={bulkTargets.length === 0}
          onClick={() => changeSelection(selectedIds.filter((id) => !bulkIds.has(id)))}
          className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold disabled:opacity-50"
        >
          取消全选
        </button>
      </div>
      <div className="h-[300px] space-y-2 overflow-y-auto rounded-xl border border-[var(--line)] p-3">
        {mode === "class" && loadingRoster ? <p className="text-xs text-[var(--muted)]">正在读取本班报名学生…</p> : null}
        {mode === "class" && rosterError ? <p className="text-xs text-[#b94d4d]">{rosterError}</p> : null}
        {mode === "class" && !loadingRoster && !rosterError && roster.length === 0 ? <p className="text-xs text-[var(--muted)]">这个班还没有在读报名学生。可以切换到「其他学生」按姓名或编号查找。</p> : null}
        {mode === "other" && query.trim().length === 0 ? <p className="text-xs text-[var(--muted)]">输入姓名或编号后再显示结果，不会把全机构学生都列出来。</p> : null}
        {mode === "other" && searching ? <p className="text-xs text-[var(--muted)]">正在查找…</p> : null}
        {mode === "other" && searchError ? <p className="text-xs text-[#b94d4d]">{searchError}</p> : null}
        {mode === "other" && query.trim() && !searching && !searchError && results.length === 0 ? (
          <p className="text-xs text-[var(--muted)]">
            {namedInClass.length > 0 ? `${namedInClass.map((student) => `${student.name}（${student.studentNo ?? "未编号"}）`).join("、")}已在本班名单里。` : "没有找到其他在读学生。"}
          </p>
        ) : null}
        {mode === "other" && query.trim() && !searching && !searchError && results.length > 0 && listed.length === 0 ? (
          <p className="text-xs text-[var(--muted)]">找到的学生已经在上面的名单里。</p>
        ) : null}
        {listed.map((student) => studentRow(student))}
      </div>
      <FieldError message={error} />
    </fieldset>
  );
}
