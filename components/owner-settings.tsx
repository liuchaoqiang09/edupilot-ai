"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";
import { saveOrganizationSettings } from "@/app/owner/settings/actions";

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
  { value: "ACADEMIC", label: "中小学辅导" },
  { value: "ART", label: "艺术培训" },
  { value: "EARLY_CHILDHOOD", label: "幼儿教育" },
];

export function OwnerSettingsForm({ settings }: { settings: OrganizationSettings }) {
  const router = useRouter();
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
        setMessage(result.message ?? "保存失败。");
        return;
      }
      setSaved(true);
      setMessage("机构设置已保存。");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit}>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-[var(--line)] bg-white">
          <div className="flex items-start justify-between gap-3 border-b border-[#eef1ee] px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold">机构基本信息</h2>
              <p className="mt-1 text-[11px] text-[var(--muted)]">管理工作台基础配置</p>
            </div>
            <span className="rounded-full bg-[#edf5f1] px-2 py-1 text-[10px] font-bold text-[#34725d]">{saved ? "刚刚保存" : "已保存"}</span>
          </div>
          <div className="grid gap-4 px-5 py-5">
            <label className="grid gap-1.5 text-xs font-bold">
              机构名称 <span className="font-medium text-[#9a6729]">必填</span>
              <input name="name" required minLength={2} maxLength={40} defaultValue={settings.name} onChange={() => setSaved(false)} className="rounded-[10px] border border-[var(--line)] px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]" />
            </label>
            <fieldset className="grid gap-2">
              <legend className="text-xs font-bold">业务类型（可多选）</legend>
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
                      {active ? "✓ " : ""}{option.label}
                    </button>
                  );
                })}
              </div>
              {types.map((value) => <input key={value} type="hidden" name="businessTypes" value={value} />)}
            </fieldset>
            <label className="grid gap-1.5 text-xs font-bold">
              默认报告语言
              <select name="reportLanguage" defaultValue={settings.reportLanguage} onChange={() => setSaved(false)} className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]">
                <option value="zh-CN">简体中文</option>
                <option value="en">English</option>
              </select>
            </label>
            <p className="text-xs text-[var(--muted)]">时区：{settings.timezone}</p>
            <div>
              <button disabled={pending} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">
                {pending ? "正在保存…" : "保存设置"}
              </button>
            </div>
            {message ? <p className={`text-xs ${saved ? "text-[#34725d]" : "text-[#b94d4d]"}`}>{message}</p> : null}
          </div>
        </section>
        <section className="rounded-2xl border border-[var(--line)] bg-white">
          <div className="border-b border-[#eef1ee] px-5 py-4">
            <h2 className="text-sm font-semibold">AI 教学分析规则</h2>
            <p className="mt-1 text-[11px] text-[var(--muted)]">配置 AI 重点关注哪些内容</p>
          </div>
          <Toggle name="aiUseRecentSummaries" title="使用近期相关课程摘要" detail="默认参考最近 3 次同一学生的相关课程" defaultChecked={settings.aiUseRecentSummaries} onChange={() => setSaved(false)} />
          <Toggle name="aiRequireEvidence" title="要求分析依据可追溯" detail="报告标注本次记录和历史记录作为依据" defaultChecked={settings.aiRequireEvidence} onChange={() => setSaved(false)} />
          <Toggle name="aiTeacherMustConfirm" title="教师确认后才能发布" detail="未经确认的 AI 草稿不会展示给家长" defaultChecked={settings.aiTeacherMustConfirm} onChange={() => setSaved(false)} />
          <Toggle name="aiOwnerSpotCheck" title="老板抽查 / 退回异常报告" detail="常规报告不要求老板逐份审批" defaultChecked={settings.aiOwnerSpotCheck} onChange={() => setSaved(false)} />
        </section>
      </div>
      <section className="mt-4 rounded-2xl border border-[var(--line)] bg-white">
        <div className="border-b border-[#eef1ee] px-5 py-4">
          <h2 className="text-sm font-semibold">账号与权限原则</h2>
          <p className="mt-1 text-[11px] text-[var(--muted)]">产品底层规则，不可由机构配置取消</p>
        </div>
        <Principle title="机构数据隔离" detail="每个机构只能访问自己的学员、课程、教师和报告数据。" />
        <Principle title="角色授权校验" detail="前端入口与服务端接口均检查角色和资源授权。" />
        <Principle title="家长数据范围" detail="家长只能查看已验证绑定孩子的已发布内容。教师内部备注不会发给家长。" />
      </section>
    </form>
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

function Principle({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[#eef1ee] px-5 py-4 last:border-b-0">
      <div>
        <strong className="block text-sm">{title}</strong>
        <p className="mt-1 text-xs leading-6 text-[var(--muted)]">{detail}</p>
      </div>
      <span className="shrink-0 rounded-full bg-[#edf5f1] px-2 py-1 text-[10px] font-bold text-[#34725d]">强制启用</span>
    </div>
  );
}
