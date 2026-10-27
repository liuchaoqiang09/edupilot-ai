"use client";

import { FormEvent, useState, useTransition } from "react";
import { changeOwnPassword } from "@/app/account/actions";
import { usePick } from "@/components/locale-provider";

export function AccountSecurity({
  email,
  phone,
  note,
}: {
  email: string;
  phone: string | null;
  note: string;
}) {
  const t = usePick();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [ok, setOk] = useState(false);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setMessage("");
    startTransition(async () => {
      const result = await changeOwnPassword(formData);
      setOk(result.ok);
      setMessage(result.message);
      if (result.ok) form.reset();
    });
  }

  return (
    <section className="max-w-xl">
      <h1 className="text-[28px] font-semibold tracking-tight">{t("账号管理", "Account")}</h1>
      <p className="mt-2 leading-7 text-[var(--muted)]">{t("登录账号不能修改。这里只能修改当前登录人自己的密码。忘记密码时，在登录页用已绑定的手机号收取验证码。", "The login cannot be changed here. You can change only your own password. If you forget it, use the bound phone number on the sign-in page.")}</p>
      <p className="mt-3 rounded-xl bg-[#f0f6ee] p-3 text-xs leading-6 text-[#4e6c5c]">{note}</p>

      <div className="mt-5 grid gap-3 rounded-2xl border border-[var(--line)] bg-white p-5">
        <label className="grid gap-1.5 text-xs font-bold">
          {t("登录账号", "Login")}
          <input value={email} readOnly className="rounded-[10px] border border-[var(--line)] bg-[#f7faf8] px-3 py-3 text-sm font-medium text-[var(--muted)]" />
        </label>
        <div className="text-xs leading-5 text-[var(--muted)]">{t("绑定手机号", "Phone")}：{phone ?? t("未绑定。绑定后才能用验证码找回密码。", "Not bound. Password recovery needs a bound phone number.")}</div>
      </div>

      <form onSubmit={save} className="mt-4 grid gap-3 rounded-2xl border border-[var(--line)] bg-white p-5">
        <div className="text-sm font-semibold">{t("修改密码", "Change password")}</div>
        <label className="grid gap-1.5 text-xs font-bold">
          {t("当前密码", "Current password")}
          <input name="current" type="password" autoComplete="current-password" required className="rounded-[10px] border border-[var(--line)] px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]" />
        </label>
        <label className="grid gap-1.5 text-xs font-bold">
          {t("新密码", "New password")}
          <input name="next" type="password" autoComplete="new-password" required minLength={8} maxLength={64} className="rounded-[10px] border border-[var(--line)] px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]" />
        </label>
        <label className="grid gap-1.5 text-xs font-bold">
          {t("再次输入新密码", "Confirm new password")}
          <input name="confirm" type="password" autoComplete="new-password" required minLength={8} maxLength={64} className="rounded-[10px] border border-[var(--line)] px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]" />
        </label>
        {message ? <p className={`text-xs leading-5 ${ok ? "text-[#34725d]" : "text-[#b94d4d]"}`}>{message}</p> : null}
        <div className="flex justify-end">
          <button disabled={pending} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">
            {pending ? t("正在保存…", "Saving…") : t("保存新密码", "Save password")}
          </button>
        </div>
      </form>
    </section>
  );
}
