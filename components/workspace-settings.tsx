"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePick } from "@/components/locale-provider";
import { isWeatherIntroEnabled, setWeatherIntroEnabled } from "@/lib/weather-pref";
import {
  defaultParentPrefs,
  defaultTeacherPrefs,
  loadParentPrefs,
  loadTeacherPrefs,
  saveParentPrefs,
  saveTeacherPrefs,
  type ParentWorkspacePrefs,
  type TeacherWorkspacePrefs,
  type XiaoxingModePref,
} from "@/lib/workspace-prefs";

function SettingsCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="h-full rounded-xl border border-[var(--line)] bg-white">
      <div className="border-b border-[#eef1ee] px-3.5 py-2.5">
        <h2 className="text-sm font-semibold leading-none">{title}</h2>
        {hint ? <p className="mt-1 text-[11px] leading-4 text-[var(--muted)]">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function ToggleRow({
  title,
  detail,
  checked,
  onChange,
}: {
  title: string;
  detail: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 border-b border-[#eef1ee] px-3.5 py-2.5 last:border-b-0">
      <span className="min-w-0">
        <strong className="block text-[13px] leading-5">{title}</strong>
        <span className="mt-0.5 block text-[11px] leading-4 text-[var(--muted)]">{detail}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--teal)]"
      />
    </label>
  );
}

function SelectRow({
  title,
  detail,
  value,
  options,
  onChange,
}: {
  title: string;
  detail: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (next: string) => void;
}) {
  return (
    <label className="grid gap-1.5 border-b border-[#eef1ee] px-3.5 py-2.5 last:border-b-0">
      <span>
        <strong className="block text-[13px] leading-5">{title}</strong>
        <span className="mt-0.5 block text-[11px] leading-4 text-[var(--muted)]">{detail}</span>
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full max-w-sm rounded-lg border border-[var(--line)] bg-white px-2.5 py-2 text-sm font-medium outline-none focus:border-[var(--teal)]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function NoteRow({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="border-b border-[#eef1ee] px-3.5 py-2.5 last:border-b-0">
      <strong className="block text-[13px] leading-5">{title}</strong>
      <p className="mt-0.5 text-[11px] leading-4 text-[var(--muted)]">{detail}</p>
    </div>
  );
}

/** 三端共用：登录天气迎宾开关 */
export function WeatherIntroSettingsCard() {
  const t = usePick();
  const [enabled, setEnabled] = useState(true);
  const [ready, setReady] = useState(false);
  const [hint, setHint] = useState("");

  useEffect(() => {
    setEnabled(isWeatherIntroEnabled());
    setReady(true);
  }, []);

  function toggle(next: boolean) {
    setEnabled(next);
    setWeatherIntroEnabled(next);
    setHint(next ? t("已开启。下次登录会显示迎宾动效。", "On. The weather intro will show after the next sign-in.") : t("已关闭。下次登录不再显示迎宾动效。", "Off. The weather intro will not show after sign-in."));
  }

  if (!ready) {
    return (
      <SettingsCard title={t("界面与迎宾", "Display & welcome")} hint={t("仅保存在本机浏览器", "Saved in this browser only")}>
        <p className="px-3.5 py-2.5 text-xs text-[var(--muted)]">{t("读取中…", "Loading…")}</p>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard title={t("界面与迎宾", "Display & welcome")} hint={t("仅保存在本机浏览器，换设备需重新设置", "Saved in this browser only")}>
      <ToggleRow
        title={t("登录后显示天气动效", "Weather welcome after sign-in")}
        detail={t("进入工作台时短暂显示晴、阴、雨或夜间迎宾（约 1 秒后淡出）。关闭后不再播放。", "A short clear / cloudy / rain / night welcome when you enter the workspace. Turn off to skip it.")}
        checked={enabled}
        onChange={toggle}
      />
      {hint ? <p className="px-3.5 py-2 text-[11px] text-[#34725d]">{hint}</p> : null}
    </SettingsCard>
  );
}

export function TeacherSettingsPanel() {
  const t = usePick();
  const [prefs, setPrefs] = useState<TeacherWorkspacePrefs>(defaultTeacherPrefs);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setPrefs(loadTeacherPrefs());
    setReady(true);
  }, []);

  function patch(next: Partial<TeacherWorkspacePrefs>) {
    setPrefs((current) => {
      const merged = { ...current, ...next };
      saveTeacherPrefs(merged);
      return merged;
    });
    setSaved(true);
  }

  if (!ready) return <p className="text-xs text-[var(--muted)]">{t("读取中…", "Loading…")}</p>;

  return (
    <div className="grid max-w-4xl grid-cols-1 gap-2.5 sm:grid-cols-2">
      <WeatherIntroSettingsCard />
      <SettingsCard title={t("课表与点名", "Schedule & check-in")} hint={t("只影响你自己的默认入口，不改点名规则", "Your defaults only. Attendance rules stay the same.")}>
        <SelectRow
          title={t("课表默认视图", "Default schedule view")}
          detail={t("打开「我的课表」时优先看到的范围（页面内仍可切换）。", "Preferred view when opening My schedule.")}
          value={prefs.scheduleView}
          options={[
            { value: "day", label: t("按日", "Day") },
            { value: "week", label: t("按周", "Week") },
          ]}
          onChange={(value) => patch({ scheduleView: value as "day" | "week" })}
        />
        <ToggleRow
          title={t("大班优先进入「学生签到」", "Prefer Check-in for large classes")}
          detail={t("记住偏好，方便从总览快捷进入签到页；小班仍可用课表快捷点名。", "Remembers that you often use the Check-in page for large classes.")}
          checked={prefs.preferAttendanceDesk}
          onChange={(value) => patch({ preferAttendanceDesk: value })}
        />
      </SettingsCard>
      <SettingsCard title={t("教学记录与报告", "Notes & reports")}>
        <ToggleRow
          title={t("记录列表待填写优先", "Pending lesson notes first")}
          detail={t("打开教学记录时，优先关注尚未写完的课次。", "Focus on lessons that still need notes.")}
          checked={prefs.recordsPendingFirst}
          onChange={(value) => patch({ recordsPendingFirst: value })}
        />
        <ToggleRow
          title={t("报告列表草稿/待确认优先", "Drafts first in reports")}
          detail={t("打开教学报告时，优先看到未发布的草稿。家长看不到未发布内容。", "Open Reports with unpublished drafts first. Parents never see drafts.")}
          checked={prefs.reportsDraftFirst}
          onChange={(value) => patch({ reportsDraftFirst: value })}
        />
      </SettingsCard>
      <SettingsCard title={t("小星助教", "Xiaoxing")} hint={t("与助教面板「问答 / 工作」一致", "Same as the assistant Ask / Work switch")}>
        <SelectRow
          title={t("默认模式", "Default mode")}
          detail={t("下次打开小星时使用的模式。工作模式仍须确认后才写入。", "Mode when you next open Xiaoxing. Work mode still needs your confirm.")}
          value={prefs.xiaoxingMode}
          options={[
            { value: "ask", label: t("问答（只读查询与用法）", "Ask (read-only)") },
            { value: "agent", label: t("工作（可确认办理）", "Work (confirm to write)") },
          ]}
          onChange={(value) => patch({ xiaoxingMode: value as XiaoxingModePref })}
        />
      </SettingsCard>
      <div className="sm:col-span-2">
        <SettingsCard title={t("边界说明", "Boundaries")}>
          <div className="sm:grid sm:grid-cols-2">
            <NoteRow title={t("发布前家长不可见", "Parents see published only")} detail={t("未确认、未发布的教学报告与内部备注不会发给家长。", "Unconfirmed drafts and private notes stay inside the school.")} />
            <NoteRow title={t("点名与课时规则", "Attendance rules")} detail={t("出勤、请假扣课时等规则由机构统一，教师端设置不能改写规则。", "Hour rules are set by the organization; these prefs cannot change them.")} />
          </div>
        </SettingsCard>
      </div>
      {saved ? <p className="text-xs text-[#34725d] sm:col-span-2">{t("偏好已保存到本机。", "Preferences saved on this device.")}</p> : null}
    </div>
  );
}

export function ParentSettingsPanel() {
  const t = usePick();
  const [prefs, setPrefs] = useState<ParentWorkspacePrefs>(defaultParentPrefs);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setPrefs(loadParentPrefs());
    setReady(true);
  }, []);

  function patch(next: Partial<ParentWorkspacePrefs>) {
    setPrefs((current) => {
      const merged = { ...current, ...next };
      saveParentPrefs(merged);
      return merged;
    });
    setSaved(true);
  }

  if (!ready) return <p className="text-xs text-[var(--muted)]">{t("读取中…", "Loading…")}</p>;

  return (
    <div className="grid max-w-4xl grid-cols-1 gap-2.5 sm:grid-cols-2">
      <WeatherIntroSettingsCard />
      <SettingsCard title={t("孩子与列表", "Children & lists")}>
        <ToggleRow
          title={t("记住上次选中的孩子", "Remember last child filter")}
          detail={t("多孩时，列表页尽量沿用你上次筛选的孩子（本机记忆）。", "With more than one child, keep the last filter on this device.")}
          checked={prefs.rememberChild}
          onChange={(value) => patch({ rememberChild: value })}
        />
      </SettingsCard>
      <SettingsCard title={t("课表与消息", "Schedule & notices")}>
        <ToggleRow
          title={t("课表较新的排在前面", "Newer lessons first")}
          detail={t("课程安排列表的默认时间顺序偏好。", "Preferred time order on the schedule list.")}
          checked={prefs.scheduleNewestFirst}
          onChange={(value) => patch({ scheduleNewestFirst: value })}
        />
        <ToggleRow
          title={t("消息未读优先", "Unread notices first")}
          detail={t("打开「消息与反馈」时，优先关注未读（页面内仍可切换）。", "Prefer unread items when opening Notices.")}
          checked={prefs.noticesUnreadFirst}
          onChange={(value) => patch({ noticesUnreadFirst: value })}
        />
      </SettingsCard>
      <SettingsCard title={t("小星助教", "Xiaoxing")}>
        <SelectRow
          title={t("默认模式", "Default mode")}
          detail={t("问答可查课表与用法；工作可请假、回报告等，仍须确认后写入。", "Ask for queries; Work for leave/replies — still confirm before writing.")}
          value={prefs.xiaoxingMode}
          options={[
            { value: "ask", label: t("问答", "Ask") },
            { value: "agent", label: t("工作", "Work") },
          ]}
          onChange={(value) => patch({ xiaoxingMode: value as XiaoxingModePref })}
        />
      </SettingsCard>
      <div className="sm:col-span-2">
        <SettingsCard title={t("边界说明", "Boundaries")}>
          <div className="sm:grid sm:grid-cols-2">
            <NoteRow title={t("仅已绑定孩子", "Linked children only")} detail={t("只能查看负责人已绑定的孩子；不能自行按姓名绑定。", "Only children linked by the organization.")} />
            <NoteRow title={t("已发布内容", "Published content")} detail={t("报告、成绩须教师发布后才可见。不能改课表或在此交费。", "Reports and scores appear after teachers publish. No schedule edits or payments here.")} />
          </div>
        </SettingsCard>
      </div>
      {saved ? <p className="text-xs text-[#34725d] sm:col-span-2">{t("偏好已保存到本机。", "Preferences saved on this device.")}</p> : null}
    </div>
  );
}
