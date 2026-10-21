"use client";

import { FormEvent, useState } from "react";

const accounts = [
  {
    email: "owner@edupilot.test",
    title: "机构负责人",
    detail: "经营概览 · 教务管理 · 教学报告",
    icon: "⌂",
  },
  {
    email: "teacher@edupilot.test",
    title: "教师",
    detail: "我的课表 · 课堂记录 · 教学报告",
    icon: "✎",
  },
  {
    email: "parent@edupilot.test",
    title: "家长",
    detail: "孩子课表 · 出勤 · 已发布学习报告",
    icon: "♡",
  },
];

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
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

      <section className="flex items-center justify-center px-6 py-16 lg:px-8">
        <div className="w-full max-w-[470px]">
          <div className="text-[11px] font-extrabold tracking-[2px] text-[var(--teal)]">EDUPILOT AI</div>
          <h2 className="mt-3 text-[29px] font-semibold tracking-tight">进入你的工作台</h2>
          <p className="mt-2 leading-7 text-[var(--muted)]">使用机构分配的账号登录。登录后只会进入你被授权的工作空间。</p>

          <form onSubmit={onSubmit} className="mt-6 grid gap-3.5">
            <label className="grid gap-1.5 text-xs font-bold">
              账号
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                placeholder="请输入账号"
                className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]"
              />
            </label>
            <label className="grid gap-1.5 text-xs font-bold">
              密码
              <span className="relative">
                <input
                  id="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="请输入密码"
                  className="w-full rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 pr-16 text-sm font-medium outline-none focus:border-[var(--teal)]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-2.5 top-2.5 bg-transparent px-1.5 py-1 text-[11px] font-medium text-[var(--muted)]"
                >
                  {showPassword ? "隐藏" : "显示"}
                </button>
              </span>
            </label>
            <div className="flex items-center justify-between text-xs text-[var(--muted)]">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                记住我
              </label>
              <button
                type="button"
                className="bg-transparent text-xs text-[var(--teal)]"
                onClick={() => setNotice("当前还没有找回密码服务。请联系机构负责人重置账号。")}
              >
                忘记密码？
              </button>
            </div>
            {error ? <div className="rounded-[9px] bg-[#fff0ed] px-2.5 py-2.5 text-xs text-[#b94d4d]">{error}</div> : null}
            {notice ? <div className="rounded-[9px] bg-[#edf2ed] px-2.5 py-2.5 text-xs text-[#5e706b]">{notice}</div> : null}
            <button
              type="submit"
              disabled={pending}
              className="rounded-[10px] bg-[var(--navy)] px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "正在登录…" : "登录工作台　→"}
            </button>
            <div className="my-1 flex items-center gap-3 text-[10px] text-[#93a19b]">
              <span className="h-px flex-1 bg-[var(--line)]" />
              或填入测试账号
              <span className="h-px flex-1 bg-[var(--line)]" />
            </div>
          </form>

          <div className="mt-4 grid gap-3">
            {accounts.map((account) => (
              <button
                key={account.email}
                type="button"
                onClick={() => {
                  setEmail(account.email);
                  setError("");
                  document.getElementById("password")?.focus();
                }}
                className="flex w-full items-center gap-3.5 rounded-2xl border border-[var(--line)] bg-white px-4 py-4 text-left transition hover:-translate-y-px hover:border-[var(--teal)] hover:shadow-[0_14px_36px_rgba(24,42,53,.07)]"
              >
                <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-[var(--teal-2)] text-xl">{account.icon}</span>
                <span>
                  <strong className="block">{account.title}</strong>
                  <small className="text-[var(--muted)]">{account.detail}</small>
                </span>
                <span className="ml-auto text-xl text-[var(--teal)]">→</span>
              </button>
            ))}
          </div>
          <div className="mt-4 rounded-xl bg-[#edf2ed] px-3 py-3 text-xs leading-relaxed text-[#5e706b]">
            身份卡片只会填入测试账号，不会直接进入工作空间。密码由服务端校验，请求里不能自行指定角色。
          </div>
        </div>
      </section>
    </div>
  );
}
