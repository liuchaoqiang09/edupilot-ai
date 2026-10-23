import type { WorkspaceArea } from "@/lib/roles";

export type NavItem = {
  href: string;
  label: string;
  description: string;
  icon: string;
};

export const areaLabel: Record<WorkspaceArea, string> = {
  owner: "机构工作台",
  teacher: "教师工作台",
  parent: "家长工作台",
};

export const roleLabel: Record<WorkspaceArea, string> = {
  owner: "机构负责人",
  teacher: "教师",
  parent: "家长",
};

export const navigation: Record<WorkspaceArea, NavItem[]> = {
  owner: [
    { href: "/owner", label: "工作台", icon: "◫", description: "查看本机构今天的教学安排和待处理事项。" },
    { href: "/owner/students", label: "学生管理", icon: "♙", description: "建立和维护学生档案。停用后仍保留历史课次与报告。" },
    { href: "/owner/teachers", label: "教师管理", icon: "✎", description: "建立教师档案。登录账号可以稍后关联。" },
    { href: "/owner/courses", label: "课程与班级", icon: "▦", description: "课程类型和班级分开管理，名称由机构自己创建。" },
    { href: "/owner/schedule", label: "排课 / 课表", icon: "▣", description: "按日期安排课次，并指定教师和学生名单。" },
    { href: "/owner/reports", label: "教学报告", icon: "✳", description: "查看教师提交的报告，必要时退回修改。" },
    { href: "/owner/billing", label: "报名与课时", icon: "¥", description: "记录报名、实收金额和剩余课时。出勤、迟到或缺勤会扣减课时。" },
    { href: "/owner/stats", label: "基础统计", icon: "▤", description: "查看出勤、课次和报告完成情况。数字只来自数据库。" },
    { href: "/owner/settings", label: "机构设置", icon: "⚙", description: "维护机构名称和报告偏好。可以以后再补全。" },
    { href: "/owner/account", label: "账号管理", icon: "☺", description: "查看自己的登录账号并修改自己的密码。不能修改老师或家长的密码。" },
  ],
  teacher: [
    { href: "/teacher", label: "总览", icon: "◫", description: "查看今天的课次、待填写记录和已发布报告。" },
    { href: "/teacher/schedule", label: "我的课表", icon: "▤", description: "只显示分配给当前教师的课次。" },
    { href: "/teacher/students", label: "我的学生", icon: "♙", description: "只显示本人授课范围内的学生。" },
    { href: "/teacher/records", label: "教学记录", icon: "✎", description: "记录本节课的内容、表现、问题和作业。" },
    { href: "/teacher/reports", label: "教学报告", icon: "✳", description: "编辑 AI 草稿，确认后再发布给家长。" },
    { href: "/teacher/account", label: "账号管理", icon: "☺", description: "查看自己的登录账号并修改自己的密码。" },
  ],
  parent: [
    { href: "/parent", label: "孩子概览", icon: "♧", description: "查看已绑定孩子的近期学习情况。" },
    { href: "/parent/schedule", label: "课程安排", icon: "▣", description: "查看已绑定孩子的课程安排。" },
    { href: "/parent/attendance", label: "出勤记录", icon: "✓", description: "查看已绑定孩子的出勤情况。" },
    { href: "/parent/reports", label: "教学报告", icon: "✳", description: "只显示教师确认并发布的报告。" },
    { href: "/parent/account", label: "账号管理", icon: "♡", description: "查看自己的登录账号、修改自己的密码，并查看已绑定的孩子。" },
  ],
};

export const helpText: Record<WorkspaceArea, { title: string; body: string }> = {
  owner: {
    title: "使用提示",
    body: "可以先进入工作台，再逐步添加课程、教师和学生。AI 只根据已有教学记录起草报告。",
  },
  teacher: {
    title: "教学记录提醒",
    body: "课堂记录越具体，报告越有依据。发布前请核对内容，未发布的草稿家长看不到。",
  },
  parent: {
    title: "学习反馈说明",
    body: "这里只会显示已绑定孩子的课程、出勤和已发布报告。",
  },
};

export function pageMeta(area: WorkspaceArea, pathname: string) {
  if (area === "owner" && pathname.startsWith("/owner/attendance")) {
    return navigation.owner.find((entry) => entry.href === "/owner/stats") ?? navigation.owner[0];
  }
  const item = navigation[area].find((entry) =>
    entry.href === `/${area}` ? pathname === entry.href : pathname === entry.href || pathname.startsWith(`${entry.href}/`),
  );
  return item ?? navigation[area][0];
}
