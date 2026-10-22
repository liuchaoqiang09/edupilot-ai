"use client";

import { useState, useTransition } from "react";
import { issueParentInvite, issueTeacherInvite } from "@/app/owner/membership/actions";

export function TeacherInviteButton({ teacherId, label = "生成教师邀请码" }: { teacherId?: string; label?: string }) {
  return <InviteButton label={label} action={() => issueTeacherInvite(teacherId)} />;
}

export function ParentInviteButton({ studentId }: { studentId: string }) {
  return <InviteButton label="生成家长绑定码" action={() => issueParentInvite(studentId)} />;
}

function InviteButton({ label, action }: { label: string; action: () => Promise<{ ok: boolean; message?: string; code?: string }> }) {
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  return (
    <div className="grid gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => {
          setError("");
          const result = await action();
          if (!result.ok || !result.code) {
            setCode("");
            setError(result.message || "没有生成邀请码。");
            return;
          }
          setCode(result.code);
        })}
        className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold"
      >
        {pending ? "正在生成…" : label}
      </button>
      {code ? <p className="text-xs leading-5 text-[var(--muted)]">邀请码只显示这一次：<strong className="text-[var(--ink)]">{code}</strong>。7 天内有效，使用一次后失效。</p> : null}
      {error ? <p className="text-xs text-[#b94d4d]">{error}</p> : null}
    </div>
  );
}
