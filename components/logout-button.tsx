"use client";

import { useState } from "react";
import { usePick } from "@/components/locale-provider";

export function LogoutButton({ className = "" }: { className?: string }) {
  const [pending, setPending] = useState(false);
  const t = usePick();

  async function logout() {
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("/login");
    }
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={pending}
      className={`rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold text-[#385058] disabled:opacity-60 ${className}`}
    >
      {pending ? t("正在退出…", "Signing out…") : t("退出登录", "Sign out")}
    </button>
  );
}
