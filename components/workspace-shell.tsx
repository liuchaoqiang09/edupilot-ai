"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useLocale, usePick } from "@/components/locale-provider";
import { AssistantWidget } from "@/components/assistant-widget";
import { LogoutButton } from "@/components/logout-button";
import { OrgSearch } from "@/components/org-search";
import { areaLabel, helpText, navigation, pageMeta, roleLabel } from "@/lib/navigation";
import type { WorkspaceArea } from "@/lib/roles";
import { confirmLeaveIfDirty } from "@/lib/unsaved-guard";

export type ShellUser = {
  name: string;
  roles: Array<"OWNER" | "TEACHER" | "PARENT">;
  organizationName: string;
};

function isActive(pathname: string, href: string, area: WorkspaceArea) {
  if (area === "owner" && href === "/owner/stats" && pathname.startsWith("/owner/attendance")) return true;
  if (href === `/${area}`) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function WorkspaceShell({
  area,
  user,
  noticeCount = 0,
  children,
}: {
  area: WorkspaceArea;
  user: ShellUser;
  noticeCount?: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const locale = useLocale();
  const t = usePick();
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const page = pageMeta(locale, area, pathname);
  const help = helpText(locale, area);
  const items = navigation(locale, area);
  const canSwitchTeacher = user.roles.includes("OWNER") && user.roles.includes("TEACHER");
  const canSwitchParent = user.roles.includes("PARENT") && (user.roles.includes("OWNER") || user.roles.includes("TEACHER"));
  const canSwitch = canSwitchTeacher || canSwitchParent;

  return (
    <div className="min-h-screen bg-[var(--paper)] md:grid md:grid-cols-[244px_1fr]">
      {open ? <button aria-label={t("关闭菜单", "Close menu")} className="fixed inset-0 z-10 bg-[#0f2022]/45 md:hidden" onClick={() => setOpen(false)} /> : null}
      <aside
        className={`fixed inset-y-0 left-0 z-20 flex w-[244px] flex-col bg-[var(--navy)] px-4 py-6 pb-16 text-[#d4e1dc] transition-transform print:hidden md:static md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex items-center gap-2.5 px-3 pb-7 text-[17px] font-extrabold text-white">
          <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-[var(--lime)] text-sm font-black text-[var(--navy)]">E</span>
          EduPilot AI
        </div>
        <div className="mx-1.5 mb-6 rounded-xl border border-[#3d5b5d] bg-[#203f43] px-3 py-3">
          <small className="mb-1 block text-[10px] text-[#91b0a8]">{area === "parent" ? t("家长账号", "Parent account") : area === "teacher" ? t("教师工作台", "Teacher workspace") : t("当前机构", "Organization")}</small>
          <strong className="text-xs text-[#f2f7f3]">{user.organizationName}</strong>
        </div>
        <div className="mb-2.5 px-3 text-[10px] font-extrabold tracking-[1.4px] text-[#72938c]">{t("工作空间", "WORKSPACE")}</div>
        <nav className="grid gap-1">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={(event) => {
                if (!confirmLeaveIfDirty()) {
                  event.preventDefault();
                  return;
                }
                setOpen(false);
              }}
              className={`flex items-center gap-3 rounded-[10px] px-3 py-3 text-[13px] ${isActive(pathname, item.href, area) ? "bg-[var(--lime)] font-bold text-[#1d3939]" : "text-[#aac1ba] hover:bg-[#25494b] hover:text-white"}`}
            >
              <span className="w-5 text-center text-[17px]">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto px-2 pt-4">
          <div className="rounded-xl border border-[#3c5a5b] p-3 text-xs leading-relaxed text-[#9bb6ae]">
            <strong className="mb-1 block text-white">{help.title}</strong>
            {help.body}
          </div>
          <div className="flex items-center gap-2.5 px-2 pt-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#dcece5] text-sm font-extrabold text-[#215a52]">{user.name.slice(0, 1)}</span>
            <span>
              <strong className="block text-xs text-white">{user.name}</strong>
              <small className="mt-1 block text-[11px] text-[#91aaa4]">{roleLabel(locale, area)}</small>
            </span>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-[5] flex h-[66px] items-center justify-between border-b border-[var(--line)] bg-white/80 px-4 backdrop-blur-md print:hidden md:h-[76px] md:px-10">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="grid h-9 w-9 place-items-center rounded-[11px] border border-[var(--line)] bg-white text-[#51656a] md:hidden"
              onClick={() => setOpen(true)}
              aria-label={t("打开菜单", "Open menu")}
            >
              ☰
            </button>
            <div className="text-xs text-[var(--muted)]">
              {areaLabel(locale, area)}　/　<strong className="text-[var(--ink)]">{page.label}</strong>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            {area === "owner" ? <OrgSearch /> : null}
            <span className="hidden rounded-full bg-[var(--teal-2)] px-2.5 py-2 text-[11px] font-bold text-[var(--teal)] sm:inline">{roleLabel(locale, area)}</span>
            {area === "parent" ? (
              <Link href="/parent/notices" title={t("消息", "Notices")} className="relative grid h-9 w-9 place-items-center rounded-[11px] border border-[var(--line)] bg-white text-[#51656a]">
                ✉
                {noticeCount > 0 ? <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--teal)] px-1 text-[10px] font-bold text-white">{noticeCount > 9 ? "9+" : noticeCount}</span> : null}
              </Link>
            ) : (
              <button
                type="button"
                title={t("通知", "Notices")}
                onClick={() => setNotice(t("目前没有新的系统通知", "There are no new notices."))}
                className="grid h-9 w-9 place-items-center rounded-[11px] border border-[var(--line)] bg-white text-[#51656a]"
              >
                ♧
              </button>
            )}
            <div className="relative">
              <button type="button" onClick={() => setMenuOpen((value) => !value)} className="flex items-center gap-2 bg-transparent text-left">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-[#dcece5] text-sm font-extrabold text-[#215a52]">{user.name.slice(0, 1)}</span>
                <span className="hidden sm:block">
                  <strong className="block text-xs">{user.name}</strong>
                  <small className="mt-0.5 block text-[10px] text-[var(--muted)]">{user.organizationName}</small>
                </span>
              </button>
              {menuOpen ? (
                <div className="absolute right-0 top-12 z-20 w-64 rounded-2xl border border-[var(--line)] bg-white p-3 shadow-[0_14px_36px_rgba(24,42,53,.07)]">
                  <p className="mb-3 text-xs leading-6 text-[var(--muted)]">
                    {user.name} · {roleLabel(locale, area)}
                  </p>
                  <div className="grid gap-2">
                    {canSwitchTeacher && area === "owner" ? (
                      <Link href="/teacher" className="rounded-[10px] border border-[var(--line)] px-3 py-2.5 text-xs font-bold text-[#385058]">
                        {t("切换到教师工作台", "Switch to teacher")}
                      </Link>
                    ) : null}
                    {canSwitchTeacher && area === "teacher" ? (
                      <Link href="/owner" className="rounded-[10px] border border-[var(--line)] px-3 py-2.5 text-xs font-bold text-[#385058]">
                        {t("切换到负责人工作台", "Switch to owner")}
                      </Link>
                    ) : null}
                    {canSwitchParent && area !== "parent" ? (
                      <Link href="/parent" className="rounded-[10px] border border-[var(--line)] px-3 py-2.5 text-xs font-bold text-[#385058]">
                        {t("切换到家长端", "Switch to parent")}
                      </Link>
                    ) : null}
                    {canSwitchParent && area === "parent" ? (
                      <>
                        {user.roles.includes("OWNER") ? (
                          <Link href="/owner" className="rounded-[10px] border border-[var(--line)] px-3 py-2.5 text-xs font-bold text-[#385058]">
                            {t("切换到负责人工作台", "Switch to owner")}
                          </Link>
                        ) : null}
                        {user.roles.includes("TEACHER") ? (
                          <Link href="/teacher" className="rounded-[10px] border border-[var(--line)] px-3 py-2.5 text-xs font-bold text-[#385058]">
                            {t("切换到教师工作台", "Switch to teacher")}
                          </Link>
                        ) : null}
                      </>
                    ) : null}
                    {!canSwitchTeacher && area === "teacher" ? <p className="text-xs leading-6 text-[var(--muted)]">{t("当前教师账号没有负责人权限。", "This teacher account does not have owner access.")}</p> : null}
                    {area === "parent" && !canSwitchParent ? <p className="text-xs leading-6 text-[var(--muted)]">{t("家长账号不能切换为负责人或教师。", "A parent account cannot switch to owner or teacher.")}</p> : null}
                    <p className="rounded-[10px] bg-[#f7f8f4] px-3 py-2.5 text-xs text-[var(--muted)]">{t("绑定手机号即将上线", "Phone binding is not on this page yet.")}</p>
                    <LogoutButton />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <div className="mx-auto max-w-[1600px] px-4 py-7 md:px-10 md:py-8">{children}</div>
      </div>
      {area === "owner" || area === "teacher" ? <AssistantWidget area={area} /> : null}
      {notice ? (
        <div className="fixed bottom-4 left-4 right-4 z-50 rounded-xl bg-[var(--navy)] px-4 py-3 text-xs text-white shadow-[0_14px_36px_rgba(24,42,53,.07)] sm:left-auto sm:max-w-[340px]">
          {notice}
        </div>
      ) : null}
    </div>
  );
}
