"use client";

import { FormEvent, useEffect, useState } from "react";

const fieldClass = "w-full rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-base font-medium outline-none focus:border-[var(--teal)]";

export function BindPhoneForm({ phone }: { phone: string | null }) {
  const [password, setPassword] = useState("");
  const [nextPhone, setNextPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [devCode, setDevCode] = useState("");
  const [pending, setPending] = useState(false);
  const [sending, setSending] = useState(false);
  const [retryUntil, setRetryUntil] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [bound, setBound] = useState(phone);

  useEffect(() => {
    if (!retryUntil) return;
    const update = () => setSecondsLeft(Math.max(0, Math.ceil((retryUntil - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [retryUntil]);

  async function sendCode() {
    setError("");
    setNotice("");
    setDevCode("");
    if (!/^1[3-9]\d{9}$/.test(nextPhone.trim())) {
      setError("请输入中国大陆手机号。");
      return;
    }
    setSending(true);
    try {
      const response = await fetch("/api/auth/phone/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: nextPhone }),
      });
      const data = (await response.json().catch(() => null)) as { message?: string; devCode?: string; retryAfterSeconds?: number } | null;
      if (!response.ok) {
        setError(data?.message || "验证码发送失败。");
        return;
      }
      setNotice(data?.message || "验证码已发送。");
      setDevCode(data?.devCode || "");
      setRetryUntil(Date.now() + (data?.retryAfterSeconds ?? 60) * 1000);
    } catch {
      setError("网络异常，请稍后重试。");
    } finally {
      setSending(false);
    }
  }

  async function bind(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setPending(true);
    try {
      const response = await fetch("/api/auth/phone/bind", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password, phone: nextPhone, code }),
      });
      const data = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        setError(data?.message || "绑定失败。");
        return;
      }
      setBound(nextPhone.trim());
      setNotice(data?.message || "手机号已绑定。");
    } catch {
      setError("网络异常，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-white p-5">
      <h2 className="text-sm font-semibold">绑定手机号</h2>
      <p className="mt-1 text-xs leading-6 text-[var(--muted)]">需要验证当前密码和新手机号的验证码。绑定不会改变角色、机构或孩子关系。</p>
      {bound ? <p className="mt-3 text-sm">当前手机号：{bound}</p> : (
        <form onSubmit={bind} className="mt-4 grid gap-3">
          <label className="grid gap-1.5 text-xs font-bold">当前密码<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" className={fieldClass} /></label>
          <label className="grid gap-1.5 text-xs font-bold">手机号<input value={nextPhone} onChange={(event) => setNextPhone(event.target.value)} inputMode="numeric" className={fieldClass} /></label>
          <label className="grid gap-1.5 text-xs font-bold">验证码
            <span className="flex gap-2">
              <input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" className={fieldClass} />
              <button type="button" disabled={sending || secondsLeft > 0} onClick={sendCode} className="shrink-0 rounded-[10px] bg-[var(--teal)] px-3 text-sm font-bold text-white disabled:opacity-60">{secondsLeft > 0 ? `${secondsLeft} 秒` : "获取验证码"}</button>
            </span>
          </label>
          {devCode ? <p className="text-xs text-[var(--muted)]">开发验证码：{devCode}</p> : null}
          {error ? <div className="rounded-[9px] bg-[#fff0ed] px-2.5 py-2.5 text-xs text-[#b94d4d]">{error}</div> : null}
          {notice ? <div className="rounded-[9px] bg-[#edf2ed] px-2.5 py-2.5 text-xs text-[#5e706b]">{notice}</div> : null}
          <button type="submit" disabled={pending} className="rounded-[10px] bg-[var(--navy)] px-4 py-3 text-sm font-bold text-white disabled:opacity-60">{pending ? "正在绑定…" : "验证并绑定"}</button>
        </form>
      )}
    </section>
  );
}
