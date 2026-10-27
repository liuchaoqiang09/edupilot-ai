import { pick, type Locale } from "@/lib/locale";
import type { WorkspaceArea } from "@/lib/roles";

export type NavItem = {
  href: string;
  label: string;
  description: string;
  icon: string;
};

const areaCopy: Record<WorkspaceArea, [string, string]> = {
  owner: ["机构工作台", "Organization"],
  teacher: ["教师工作台", "Teacher"],
  parent: ["家长工作台", "Parent"],
};

const roleCopy: Record<WorkspaceArea, [string, string]> = {
  owner: ["机构负责人", "Owner"],
  teacher: ["教师", "Teacher"],
  parent: ["家长", "Parent"],
};

export function areaLabel(locale: Locale, area: WorkspaceArea) {
  const [zh, en] = areaCopy[area];
  return pick(locale, zh, en);
}

export function roleLabel(locale: Locale, area: WorkspaceArea) {
  const [zh, en] = roleCopy[area];
  return pick(locale, zh, en);
}

const navigationCopy: Record<WorkspaceArea, Array<NavItem & { labelEn: string; descriptionEn: string }>> = {
  owner: [
    { href: "/owner", label: "工作台", labelEn: "Home", icon: "◫", description: "查看本机构今天的教学安排和待处理事项。", descriptionEn: "Today's classes and items that need attention." },
    { href: "/owner/todos", label: "待办中心", labelEn: "To-do", icon: "☑", description: "续费、教学记录、报告、试听和满班排队。", descriptionEn: "Renewals, lesson notes, reports, trials, and full classes." },
    { href: "/owner/students", label: "学生管理", labelEn: "Students", icon: "♙", description: "建立和维护学生档案。停用后仍保留历史课次与报告。", descriptionEn: "Student records. Inactive students keep their past lessons and reports." },
    { href: "/owner/teachers", label: "教师管理", labelEn: "Teachers", icon: "✎", description: "建立教师档案。登录账号可以稍后关联。", descriptionEn: "Teacher records. A login can be linked later." },
    { href: "/owner/courses", label: "课程与班级", labelEn: "Courses", icon: "▦", description: "课程类型和班级分开管理，名称由机构自己创建。", descriptionEn: "Courses and classes. Names are created by the organization." },
    { href: "/owner/rooms", label: "教室管理", labelEn: "Rooms", icon: "⌂", description: "维护教室名称、容量和是否可用。", descriptionEn: "Room name, capacity, and whether it can be booked." },
    { href: "/owner/schedule", label: "排课 / 课表", labelEn: "Schedule", icon: "▣", description: "按日期安排课次，并指定教师和学生名单。", descriptionEn: "Plan lessons by date, with a teacher and a student list." },
    { href: "/owner/reports", label: "教学报告", labelEn: "Reports", icon: "✳", description: "查看教师提交的报告，必要时退回修改。", descriptionEn: "Review teacher reports and return one when it needs changes." },
    { href: "/owner/billing", label: "报名与课时", labelEn: "Enrollment", icon: "¥", description: "记录报名、实收金额和剩余课时。出勤、迟到或缺勤会扣减课时。", descriptionEn: "Enrollment, payments, and remaining hours." },
    { href: "/owner/audit", label: "操作记录", labelEn: "Activity", icon: "☰", description: "查看课时调整、收款、退费和作废是谁在什么时候做的。", descriptionEn: "Who changed hours, payments, refunds, and voids." },
    { href: "/owner/stats", label: "基础统计", labelEn: "Statistics", icon: "▤", description: "查看出勤、课次和报告完成情况。数字只来自数据库。", descriptionEn: "Attendance, lessons, and report progress from this organization's data." },
    { href: "/owner/settings", label: "机构设置", labelEn: "Settings", icon: "⚙", description: "维护机构名称和语言。可以以后再补全。", descriptionEn: "Organization name and language." },
    { href: "/owner/account", label: "账号管理", labelEn: "Account", icon: "☺", description: "查看自己的登录账号并修改自己的密码。不能修改老师或家长的密码。", descriptionEn: "View this login and change only your own password." },
  ],
  teacher: [
    { href: "/teacher", label: "总览", labelEn: "Home", icon: "◫", description: "查看今天的课次、待填写记录和已发布报告。", descriptionEn: "Today's lessons, records still to write, and published reports." },
    { href: "/teacher/schedule", label: "我的课表", labelEn: "My schedule", icon: "▤", description: "只显示分配给当前教师的课次。", descriptionEn: "Lessons assigned to the signed-in teacher." },
    { href: "/teacher/students", label: "我的学生", labelEn: "My students", icon: "♙", description: "只显示本人授课范围内的学生。", descriptionEn: "Students in the classes this teacher covers." },
    { href: "/teacher/records", label: "教学记录", labelEn: "Lesson notes", icon: "✎", description: "记录本节课的内容、表现、问题和作业。", descriptionEn: "What was taught, how the student did, difficulties, and homework." },
    { href: "/teacher/reports", label: "教学报告", labelEn: "Reports", icon: "✳", description: "编辑 AI 草稿，确认后再发布给家长。", descriptionEn: "Edit the draft, then confirm it before parents can see it." },
    { href: "/teacher/account", label: "账号管理", labelEn: "Account", icon: "☺", description: "查看自己的登录账号并修改自己的密码。", descriptionEn: "View this login and change only your own password." },
  ],
  parent: [
    { href: "/parent", label: "孩子概览", labelEn: "Overview", icon: "♧", description: "查看已绑定孩子的近期学习情况。", descriptionEn: "Recent learning for the linked children." },
    { href: "/parent/courses", label: "课时与费用", labelEn: "Hours and fees", icon: "¥", description: "查看已绑定孩子的剩余课时、有效期和待缴。", descriptionEn: "Remaining hours, validity, and any amount still due." },
    { href: "/parent/schedule", label: "课程安排", labelEn: "Schedule", icon: "▣", description: "查看已绑定孩子的课程安排。", descriptionEn: "Upcoming lessons for the linked children." },
    { href: "/parent/homework", label: "作业", labelEn: "Homework", icon: "✎", description: "教师保存作业后就能看，不用等报告发布。", descriptionEn: "Homework appears as soon as the teacher saves it." },
    { href: "/parent/attendance", label: "出勤记录", labelEn: "Attendance", icon: "✓", description: "查看已绑定孩子的出勤情况。", descriptionEn: "Attendance for the linked children." },
    { href: "/parent/reports", label: "教学报告", labelEn: "Reports", icon: "✳", description: "只显示教师确认并发布的报告。", descriptionEn: "Reports a teacher has published." },
    { href: "/parent/notices", label: "消息", labelEn: "Notices", icon: "✉", description: "查看课次变动、作业、报告和补课提醒。", descriptionEn: "Lesson changes, homework, reports, and makeup notices." },
    { href: "/parent/account", label: "账号管理", labelEn: "Account", icon: "♡", description: "查看自己的登录账号、修改自己的密码，并查看已绑定的孩子。", descriptionEn: "This login, your password, and the linked children." },
  ],
};

export function navigation(locale: Locale, area: WorkspaceArea): NavItem[] {
  return navigationCopy[area].map((item) => ({
    href: item.href,
    icon: item.icon,
    label: pick(locale, item.label, item.labelEn),
    description: pick(locale, item.description, item.descriptionEn),
  }));
}

const helpCopy: Record<WorkspaceArea, { title: [string, string]; body: [string, string] }> = {
  owner: {
    title: ["使用提示", "Tip"],
    body: ["可以先进入工作台，再逐步添加课程、教师和学生。AI 只根据已有教学记录起草报告。", "Start from Home, then add courses, teachers, and students. Reports are drafted only from lesson notes that already exist."],
  },
  teacher: {
    title: ["教学记录提醒", "Lesson notes"],
    body: ["课堂记录越具体，报告越有依据。发布前请核对内容，未发布的草稿家长看不到。", "Specific notes make a better report. Parents cannot see a draft until it is published."],
  },
  parent: {
    title: ["学习反馈说明", "What you can see"],
    body: ["这里显示已绑定孩子的课时、课表、出勤、作业和已发布报告。课次变动会留在消息里。", "Hours, the timetable, attendance, homework, and published reports for the linked children. Lesson changes stay in Notices."],
  },
};

export function helpText(locale: Locale, area: WorkspaceArea) {
  const help = helpCopy[area];
  return { title: pick(locale, help.title[0], help.title[1]), body: pick(locale, help.body[0], help.body[1]) };
}

export function pageMeta(locale: Locale, area: WorkspaceArea, pathname: string) {
  const items = navigation(locale, area);
  if (area === "owner" && pathname.startsWith("/owner/attendance")) {
    return items.find((entry) => entry.href === "/owner/stats") ?? items[0];
  }
  const item = items.find((entry) =>
    entry.href === `/${area}` ? pathname === entry.href : pathname === entry.href || pathname.startsWith(`${entry.href}/`),
  );
  return item ?? items[0];
}
