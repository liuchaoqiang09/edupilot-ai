"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";
import { saveOrganizationSettings } from "@/app/owner/settings/actions";
import { usePick } from "@/components/locale-provider";
import { WeatherIntroSettingsCard } from "@/components/workspace-settings";

export type OrganizationSettings = {
  name: string;
  timezone: string;
  reportLanguage: string;
  businessTypes: string[];
  aiUseRecentSummaries: boolean;
  aiRequireEvidence: boolean;
  aiTeacherMustConfirm: boolean;
  aiOwnerSpotCheck: boolean;
};

const businessOptions = [
  { value: "ACADEMIC", zh: "中小学辅导", en: "Academic tutoring" },
  { value: "ART", zh: "艺术培训", en: "Arts" },
  { value: "EARLY_CHILDHOOD", zh: "幼儿教育", en: "Early childhood" },
];

export function OwnerSettingsForm({ settings }: { settings: OrganizationSettings }) {
  const router = useRouter();
  const t = usePick();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const [types, setTypes] = useState(settings.businessTypes);

  function toggleType(value: string) {
    setSaved(false);
    setTypes((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setMessage("");
    startTransition(async () => {
      const result = await saveOrganizationSettings(formData);
      if (!result.ok) {
        setSaved(false);
        setMessage(result.message ?? t("保存失败。", "Could not save."));
        return;
      }
      setSaved(true);
      setMessage(t("机构设置已保存。语言已切换的页面会在刷新后更新。", "Settings saved. Pages use the new language after they refresh."));
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit}>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-[var(--line)] bg-white">
          <div className="flex items-start justify-between gap-3 border-b border-[#eef1ee] px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold">{t("机构基本信息", "Organization")}</h2>
              <p className="mt-1 text-[11px] text-[var(--muted)]">{t("管理工作台基础配置", "Name, business, and language")}</p>
            </div>
            <span className="rounded-full bg-[#edf5f1] px-2 py-1 text-[10px] font-bold text-[#34725d]">{saved ? t("刚刚保存", "Just saved") : t("已保存", "Saved")}</span>
          </div>
          <div className="grid gap-4 px-5 py-5">
            <label className="grid gap-1.5 text-xs font-bold">
              {t("机构名称", "Organization name")} <span className="font-medium text-[#9a6729]">{t("必填", "Required")}</span>
              <input name="name" required minLength={2} maxLength={40} defaultValue={settings.name} onChange={() => setSaved(false)} className="rounded-[10px] border border-[var(--line)] px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]" />
            </label>
            <fieldset className="grid gap-2">
              <legend className="text-xs font-bold">{t("业务类型（可多选）", "Business types")}</legend>
              <div className="flex flex-wrap gap-2">
                {businessOptions.map((option) => {
                  const active = types.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => toggleType(option.value)}
                      className={`rounded-full px-3 py-1.5 text-xs font-bold ${active ? "bg-[#e4f2ee] text-[var(--teal)]" : "bg-[#f4f6f5] text-[var(--muted)]"}`}
                    >
                      {active ? "✓ " : ""}{t(option.zh, option.en)}
                    </button>
                  );
                })}
              </div>
              {types.map((value) => <input key={value} type="hidden" name="businessTypes" value={value} />)}
            </fieldset>
            <label className="grid gap-1.5 text-xs font-bold">
              {t("语言设置", "Language")}
              <select name="reportLanguage" defaultValue={settings.reportLanguage} onChange={() => setSaved(false)} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]">
                <option value="zh-CN">简体中文</option>
                <option value="en">English</option>
              </select>
              <span className="font-medium text-[var(--muted)]">{t("切换后，菜单、按钮、标题和提示改为英语。已经保存的姓名、课程、备注和报告正文保持原样。新生成的教学报告也使用这个语言。", "Menus, buttons, titles, and prompts follow this language. Saved names, courses, notes, and report text stay as written. New reports are generated in this language.")}</span>
            </label>
            <p className="text-xs text-[var(--muted)]">{t("时区", "Time zone")}：{settings.timezone}</p>
            <div>
              <button disabled={pending} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">
                {pending ? t("正在保存…", "Saving…") : t("保存设置", "Save")}
              </button>
            </div>
            {message ? <p className={`text-xs ${saved ? "text-[#34725d]" : "text-[#b94d4d]"}`}>{message}</p> : null}
          </div>
        </section>
        <section className="rounded-2xl border border-[var(--line)] bg-white">
          <div className="border-b border-[#eef1ee] px-5 py-4">
            <h2 className="text-sm font-semibold">{t("AI 教学分析规则", "Report rules")}</h2>
            <p className="mt-1 text-[11px] text-[var(--muted)]">{t("配置 AI 重点关注哪些内容", "How new reports are drafted")}</p>
          </div>
          <Toggle name="aiUseRecentSummaries" title={t("使用近期相关课程摘要", "Use recent lesson summaries")} detail={t("默认参考最近 3 次同一学生的相关课程", "Up to the last 3 related lessons for the same student")} defaultChecked={settings.aiUseRecentSummaries} onChange={() => setSaved(false)} />
          <Toggle name="aiRequireEvidence" title={t("要求分析依据可追溯", "Keep the analysis traceable")} detail={t("报告标注本次记录和历史记录作为依据", "The draft stays tied to this lesson and earlier notes")} defaultChecked={settings.aiRequireEvidence} onChange={() => setSaved(false)} />
          <Toggle name="aiTeacherMustConfirm" title={t("教师确认后才能发布", "A teacher confirms before publishing")} detail={t("未经确认的 AI 草稿不会展示给家长", "Parents do not see an unconfirmed draft")} defaultChecked={settings.aiTeacherMustConfirm} onChange={() => setSaved(false)} />
          <Toggle name="aiOwnerSpotCheck" title={t("老板抽查 / 退回异常报告", "Owner can return a report")} detail={t("常规报告不要求老板逐份审批", "Ordinary reports do not need owner approval")} defaultChecked={settings.aiOwnerSpotCheck} onChange={() => setSaved(false)} />
        </section>
      </div>
      <section className="mt-4 rounded-2xl border border-[var(--line)] bg-white">
        <div className="border-b border-[#eef1ee] px-5 py-4">
          <h2 className="text-sm font-semibold">{t("账号与权限原则", "Access rules")}</h2>
          <p className="mt-1 text-[11px] text-[var(--muted)]">{t("产品底层规则，不可由机构配置取消", "These rules stay on for every organization")}</p>
        </div>
        <Principle title={t("机构数据隔离", "Organization data stays separate")} detail={t("每个机构只能访问自己的学员、课程、教师和报告数据。", "Each organization only sees its own students, courses, teachers, and reports.")} always={t("强制启用", "Always on")} />
        <Principle title={t("角色授权校验", "Role checks")} detail={t("前端入口与服务端接口均检查角色和资源授权。", "Pages and server actions both check the role and the record.")} always={t("强制启用", "Always on")} />
        <Principle title={t("家长数据范围", "Parent access")} detail={t("家长只能查看已验证绑定孩子的已发布内容。教师内部备注不会发给家长。", "A parent sees published content for linked children. Internal notes stay with the organization.")} always={t("强制启用", "Always on")} />
      </section>
    </form>
  );
}

/** 机构设置页下方：个人界面偏好（不进机构保存接口） */
export function OwnerPersonalSettings() {
  const t = usePick();
  return (
    <div className="mt-4 max-w-xl">
      <p className="mb-2 text-xs font-bold text-[var(--muted)]">{t("我的界面（个人）", "My display (personal)")}</p>
      <WeatherIntroSettingsCard />
    </div>
  );
}

function Toggle({
  name,
  title,
  detail,
  defaultChecked,
  onChange,
}: {
  name: string;
  title: string;
  detail: string;
  defaultChecked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 border-b border-[#eef1ee] px-5 py-4 last:border-b-0">
      <span>
        <strong className="block text-sm">{title}</strong>
        <span className="mt-1 block text-xs leading-6 text-[var(--muted)]">{detail}</span>
      </span>
      <input type="checkbox" name={name} defaultChecked={defaultChecked} onChange={onChange} className="h-5 w-5 accent-[var(--teal)]" />
    </label>
  );
}

function Principle({ title, detail, always }: { title: string; detail: string; always: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[#eef1ee] px-5 py-4 last:border-b-0">
      <div>
        <strong className="block text-sm">{title}</strong>
        <p className="mt-1 text-xs leading-6 text-[var(--muted)]">{detail}</p>
      </div>
      <span className="shrink-0 rounded-full bg-[#edf5f1] px-2 py-1 text-[10px] font-bold text-[#34725d]">{always}</span>
    </div>
  );
}
