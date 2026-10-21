"use client";

import { FormEvent, useEffect, useState } from "react";

const accounts = [
  { email: "demo_owner@edupilot.test", title: "机构负责人", detail: "经营概览 · 教务管理 · 教学报告", icon: "⌂" },
  { email: "demo_teacher@edupilot.test", title: "教师", detail: "我的课表 · 课堂记录 · 教学报告", icon: "✎" },
  { email: "demo_parent@edupilot.test", title: "家长", detail: "孩子课表 · 出勤 · 已发布学习报告", icon: "♡" },
];

const fieldClass = "w-full rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-base font-medium outline-none focus:border-[var(--teal)]";

export function LoginScreen() {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [ticket, setTicket] = useState("");
  const [readyToJoin, setReadyToJoin] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [devCode, setDevCode] = useState("");
  const [pending, setPending] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetPhone, setResetPhone] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [sending, setSending] = useState(false);
  const [retryUntil, setRetryUntil] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);

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
    if (!/^1[3-9]\d{9}$/.test(phone.trim())) {
      setError("请输入中国大陆手机号。");
      return;
    }
    setSending(true);
    try {
      const response = await fetch("/api/auth/phone/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = (await response.json().catch(() => null)) as { message?: string; devCode?: string; retryAfterSeconds?: number } | null;
      if (!response.ok) {
        setError(data?.message || "验证码发送失败，请稍后重试。");
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

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!/^1[3-9]\d{9}$/.test(phone.trim())) {
      setError("请输入中国大陆手机号。");
      return;
    }
    if (!/^\d{6}$/.test(code.trim())) {
      setError("请输入 6 位数字验证码。");
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/auth/phone/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, code }),
      });
      const data = (await response.json().catch(() => null)) as { message?: string; redirect?: string; status?: string; ticket?: string } | null;
      if (!response.ok) {
        setError(data?.message || "验证码不正确。");
        return;
      }
      if (data?.redirect) {
        window.location.assign(data.redirect);
        return;
      }
      if (data?.ticket && (data.status === "register" || data.status === "pending")) {
        setTicket(data.ticket);
        setReadyToJoin(data.status === "pending");
        setNotice(data.message || "");
        return;
      }
      setNotice(data?.message || "操作已完成。");
    } catch {
      setError("网络异常，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (name.trim().length < 2 || name.trim().length > 40) {
      setError("姓名需要 2 到 40 个字。");
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/auth/phone/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticket, name }),
      });
      const data = (await response.json().catch(() => null)) as { message?: string; ticket?: string } | null;
      if (!response.ok || !data?.ticket) {
        setError(data?.message || "登记失败，请重新验证手机号。");
        return;
      }
      setTicket(data.ticket);
      setReadyToJoin(true);
      setCode("");
      setNotice(data.message || "已登记。");
    } catch {
      setError("网络异常，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  async function submitJoin(event: FormEvent<HTMLFormElement>, kind: "organization" | "invite") {
    event.preventDefault();
    setError("");
    setNotice("");
    setPending(true);
    try {
      const response = await fetch(kind === "organization" ? "/api/auth/phone/organization" : "/api/auth/phone/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(kind === "organization" ? { ticket, name: orgName } : { ticket, code: inviteCode }),
      });
      const data = (await response.json().catch(() => null)) as { message?: string; redirect?: string } | null;
      if (!response.ok || !data?.redirect) {
        setError(data?.message || "没有完成加入。");
        return;
      }
      window.location.assign(data.redirect);
    } catch {
      setError("网络异常，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  async function sendResetCode() {
    setError("");
    setNotice("");
    setDevCode("");
    if (!/^1[3-9]\d{9}$/.test(resetPhone.trim())) {
      setError("请输入中国大陆手机号。");
      return;
    }
    setSending(true);
    try {
      const response = await fetch("/api/auth/phone/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: resetPhone }),
      });
      const data = (await response.json().catch(() => null)) as { message?: string; devCode?: string; retryAfterSeconds?: number } | null;
      if (!response.ok) {
        setError(data?.message || "验证码发送失败，请稍后重试。");
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

  async function submitPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (resetPassword !== resetConfirm) {
      setError("两次输入的新密码不一致。");
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/auth/password/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: resetPhone, code: resetCode, password: resetPassword, confirm: resetConfirm }),
      });
      const data = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        setError(data?.message || "密码没有重置。");
        return;
      }
      setResetting(false);
      setPassword("");
      setNotice(data?.message || "密码已重置。请用新密码登录。");
    } catch {
      setError("网络异常，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  async function passwordLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!email.trim() || !password) {
      setError("请输入账号和密码。");
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, remember }),
      });
      const data = (await response.json().catch(() => null)) as { message?: string; redirect?: string } | null;
      if (!response.ok || !data?.redirect) {
        setError(data?.message || "账号或密码不正确。");
        return;
      }
      window.location.assign(data.redirect);
    } catch {
      setError("网络异常，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid min-h-screen bg-[#f7f8f4] lg:grid-cols-[1.05fr_0.95fr]">
      <section className="relative hidden overflow-hidden bg-[var(--navy)] text-white lg:flex lg:flex-col lg:justify-between lg:px-[clamp(28px,6vw,90px)] lg:py-14">
        <div className="pointer-events-none absolute -bottom-32 -right-32 h-[430px] w-[430px] rounded-full border border-[#54736e] shadow-[0_0_0_48px_#24484a,0_0_0_96px_#1d3e42]" />
        <div className="relative z-10 flex items-center gap-3 text-[19px] font-extrabold tracking-tight">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--lime)] font-black text-[var(--navy)]">E</span>
          EduPilot AI
        </div>
        <div className="relative z-10 max-w-[530px] py-16">
          <div className="text-[11px] font-extrabold tracking-[2px] text-[#a8cbc0]">TEACHING · INSIGHT · GROWTH</div>
          <h1 className="mt-4 text-[clamp(34px,4.5vw,58px)] font-semibold leading-[1.13] tracking-[-2px]">
            把机构管理，
            <br />
            变成更清晰的日常。
          </h1>
          <p className="mt-4 max-w-[440px] text-base leading-8 text-[#b7cbc6]">
            从排课、学员管理到 AI 课后反馈。让教学过程有记录，让每一次进步都有依据。
          </p>
          <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-[#486b68] px-3.5 py-2.5 text-xs text-[#d4e5df]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--lime)]" />
            为中小培训机构设计的 AI 教学工作台
          </div>
        </div>
        <div className="relative z-10 text-xs text-[#8daaa4]">小型培训机构的教学与日常管理平台</div>
      </section>

      <section className="flex items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
        <div className="w-full max-w-[470px]">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--lime)] font-black text-[var(--navy)]">E</span>
            <span className="text-lg font-extrabold text-[var(--navy)]">EduPilot AI</span>
          </div>
          <div className="text-[11px] font-extrabold tracking-[2px] text-[var(--teal)]">EDUPILOT AI</div>
          <h2 className="mt-3 text-[29px] font-semibold tracking-tight">账号密码登录</h2>
          <p className="mt-2 leading-7 text-[var(--muted)]">使用机构分配的账号登录。登录后只会进入你被授权的工作空间。</p>

          {false && !ticket ? (
            <form onSubmit={verifyCode} className="mt-6 grid gap-3.5">
              <label className="grid gap-1.5 text-xs font-bold">
                手机号 <span className="font-medium text-[#9a6729]">必填</span>
                <input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="numeric" autoComplete="tel" placeholder="请输入中国大陆手机号" className={fieldClass} />
              </label>
              <label className="grid gap-1.5 text-xs font-bold">
                验证码 <span className="font-medium text-[#9a6729]">必填</span>
                <span className="flex gap-2">
                  <input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6 位数字" className={fieldClass} />
                  <button type="button" disabled={sending || secondsLeft > 0} onClick={sendCode} className="shrink-0 rounded-[10px] bg-[var(--lime)] px-3 text-xs font-bold text-[var(--navy)] disabled:cursor-not-allowed disabled:opacity-60">
                    {sending ? "正在发送…" : secondsLeft > 0 ? `${secondsLeft}s` : "获取验证码"}
                  </button>
                </span>
              </label>
              {error ? <div className="rounded-[9px] bg-[#fff0ed] px-2.5 py-2.5 text-xs text-[#b94d4d]">{error}</div> : null}
              {notice ? <div className="rounded-[9px] bg-[#edf2ed] px-2.5 py-2.5 text-xs text-[#5e706b]">{notice}</div> : null}
              {devCode ? <div className="rounded-[9px] bg-[var(--lime)] px-2.5 py-2.5 text-xs font-bold text-[var(--navy)]">开发环境验证码：{devCode}</div> : null}
              <button type="submit" disabled={pending} className="rounded-[10px] bg-[var(--navy)] px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">
                {pending ? "正在验证…" : "登录　→"}
              </button>
            </form>
          ) : null}

          {false && ticket && !readyToJoin ? (
            <form onSubmit={register} className="mt-6 grid gap-3.5">
              <label className="grid gap-1.5 text-xs font-bold">
                姓名 <span className="font-medium text-[#9a6729]">必填</span>
                <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="请输入姓名" className={fieldClass} />
              </label>
              {error ? <div className="rounded-[9px] bg-[#fff0ed] px-2.5 py-2.5 text-xs text-[#b94d4d]">{error}</div> : null}
              {notice ? <div className="rounded-[9px] bg-[#edf2ed] px-2.5 py-2.5 text-xs text-[#5e706b]">{notice}</div> : null}
              <button type="submit" disabled={pending} className="rounded-[10px] bg-[var(--navy)] px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">
                {pending ? "正在登记…" : "完成登记"}
              </button>
              <button type="button" onClick={() => { setTicket(""); setReadyToJoin(false); setError(""); }} className="bg-transparent text-xs font-bold text-[var(--teal)]">返回手机号登录</button>
            </form>
          ) : null}

          {false && readyToJoin ? (
            <div className="mt-6 grid gap-3.5">
              <form onSubmit={(event) => submitJoin(event, "organization")} className="grid gap-2">
                <label className="grid gap-1.5 text-xs font-bold">
                  机构名称 <span className="font-medium text-[#9a6729]">创建时必填</span>
                  <input value={orgName} onChange={(event) => setOrgName(event.target.value)} placeholder="例如：青禾成长中心" className={fieldClass} />
                </label>
                <button type="submit" disabled={pending} className="rounded-[10px] bg-[var(--navy)] px-4 py-3 text-sm font-bold text-white disabled:opacity-60">{pending ? "正在创建…" : "创建机构并成为负责人"}</button>
              </form>
              <form onSubmit={(event) => submitJoin(event, "invite")} className="grid gap-2">
                <label className="grid gap-1.5 text-xs font-bold">
                  邀请码
                  <input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} placeholder="输入负责人发给你的邀请码" className={fieldClass} />
                </label>
                <button type="submit" disabled={pending} className="rounded-[10px] border border-[var(--line)] bg-white px-4 py-3 text-sm font-bold disabled:opacity-60">{pending ? "正在加入…" : "使用邀请码加入"}</button>
              </form>
              {error ? <div className="rounded-[9px] bg-[#fff0ed] px-2.5 py-2.5 text-xs text-[#b94d4d]">{error}</div> : null}
              {notice ? <div className="rounded-[9px] bg-[#edf2ed] px-2.5 py-2.5 text-xs text-[#5e706b]">{notice}</div> : null}
            </div>
          ) : null}

          {resetting ? (
            <form onSubmit={submitPasswordReset} className="mt-6 grid gap-3.5">
              <p className="text-sm leading-6 text-[var(--muted)]">用已绑定的手机号收取验证码，然后设置新密码。账号本身不会改变。</p>
              <label className="grid gap-1.5 text-xs font-bold">
                手机号 <span className="font-medium text-[#9a6729]">必填</span>
                <span className="flex gap-2">
                  <input value={resetPhone} onChange={(event) => setResetPhone(event.target.value)} inputMode="numeric" autoComplete="tel" placeholder="请输入绑定的手机号" className={fieldClass} />
                  <button type="button" disabled={sending || secondsLeft > 0} onClick={sendResetCode} className="shrink-0 rounded-[10px] bg-[var(--lime)] px-3 text-xs font-bold text-[var(--navy)] disabled:cursor-not-allowed disabled:opacity-60">
                    {sending ? "正在发送…" : secondsLeft > 0 ? `${secondsLeft}s` : "获取验证码"}
                  </button>
                </span>
              </label>
              <label className="grid gap-1.5 text-xs font-bold">
                验证码 <span className="font-medium text-[#9a6729]">必填</span>
                <input value={resetCode} onChange={(event) => setResetCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6 位数字" className={fieldClass} />
              </label>
              <label className="grid gap-1.5 text-xs font-bold">
                新密码 <span className="font-medium text-[#9a6729]">必填</span>
                <input value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} type="password" autoComplete="new-password" placeholder="8 到 64 位" className={fieldClass} />
              </label>
              <label className="grid gap-1.5 text-xs font-bold">
                再次输入新密码 <span className="font-medium text-[#9a6729]">必填</span>
                <input value={resetConfirm} onChange={(event) => setResetConfirm(event.target.value)} type="password" autoComplete="new-password" placeholder="再输入一次" className={fieldClass} />
              </label>
              {error ? <div className="rounded-[9px] bg-[#fff0ed] px-2.5 py-2.5 text-xs text-[#b94d4d]">{error}</div> : null}
              {notice ? <div className="rounded-[9px] bg-[#edf2ed] px-2.5 py-2.5 text-xs text-[#5e706b]">{notice}</div> : null}
              {devCode ? <div className="rounded-[9px] bg-[var(--lime)] px-2.5 py-2.5 text-xs font-bold text-[var(--navy)]">开发环境验证码：{devCode}</div> : null}
              <button type="submit" disabled={pending} className="rounded-[10px] bg-[var(--navy)] px-4 py-3 text-sm font-bold text-white disabled:opacity-60">{pending ? "正在重置…" : "重置密码"}</button>
              <button type="button" onClick={() => { setResetting(false); setError(""); setNotice(""); }} className="bg-transparent text-xs font-bold text-[var(--teal)]">返回登录</button>
            </form>
          ) : (
            <form onSubmit={passwordLogin} className="mt-6 grid gap-3.5">
              <p className="rounded-[10px] bg-[var(--lime)] px-3 py-2.5 text-xs font-bold leading-5 text-[var(--navy)]">短信登录即将上线。内测请使用下方账号密码登录。</p>
              <label className="grid gap-1.5 text-xs font-bold">
                账号 <span className="font-medium text-[#9a6729]">必填</span>
                <input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" placeholder="请输入账号" className={fieldClass} />
              </label>
              <label className="grid gap-1.5 text-xs font-bold">
                密码 <span className="font-medium text-[#9a6729]">必填</span>
                <span className="relative">
                  <input id="password" value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="请输入密码" className={`${fieldClass} pr-16`} />
                  <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-2.5 top-2.5 bg-transparent px-1.5 py-1 text-[11px] font-medium text-[var(--muted)]">
                    {showPassword ? "隐藏" : "显示"}
                  </button>
                </span>
              </label>
              <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                  记住我
                </label>
                <button type="button" onClick={() => { setResetting(true); setError(""); setNotice(""); }} className="bg-transparent font-bold text-[var(--teal)]">忘记密码</button>
              </div>
              {error ? <div className="rounded-[9px] bg-[#fff0ed] px-2.5 py-2.5 text-xs text-[#b94d4d]">{error}</div> : null}
              {notice ? <div className="rounded-[9px] bg-[#edf2ed] px-2.5 py-2.5 text-xs text-[#5e706b]">{notice}</div> : null}
              <button type="submit" disabled={pending} className="rounded-[10px] bg-[var(--navy)] px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">
                {pending ? "正在登录…" : "登录工作台　→"}
              </button>
              <div className="mt-2 grid gap-3">
                {accounts.map((account) => (
                  <button key={account.email} type="button" onClick={() => { setEmail(account.email); setError(""); document.getElementById("password")?.focus(); }} className="flex w-full items-center gap-3.5 rounded-2xl border border-[var(--line)] bg-white px-4 py-4 text-left transition hover:-translate-y-px hover:border-[var(--teal)] hover:shadow-[0_14px_36px_rgba(24,42,53,.07)]">
                    <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-[var(--teal-2)] text-xl">{account.icon}</span>
                    <span>
                      <strong className="block">{account.title}</strong>
                      <small className="text-[var(--muted)]">{account.detail}</small>
                    </span>
                    <span className="ml-auto text-xl text-[var(--teal)]">→</span>
                  </button>
                ))}
              </div>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
