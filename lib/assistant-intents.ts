export type WorkspaceJump = { href: string; reply: string };

function stamp(href: string) {
  const join = href.includes("?") ? "&" : "?";
  return `${href}${join}open=${Date.now()}`;
}

export function workspaceJump(area: "owner" | "teacher", raw: string): WorkspaceJump | null {
  const text = raw.replace(/\s+/g, "");
  if (!text) return null;
  if ((/多少|几个|几节|欠费|有没有|为什么|查询/.test(text) || /[?？]/.test(raw)) && !/打开|带我|跳转|我要|去/.test(text)) return null;
  if (/\d+\s*(元|节)/.test(raw) || /交\d+/.test(text)) return null;

  if (area === "teacher") {
    if (/报名|收款|缴费|财务/.test(text)) return null;
    if (/报告/.test(text)) return { href: "/teacher/reports", reply: "教学报告已打开。" };
    if (/记录/.test(text)) return { href: "/teacher/records", reply: "教学记录已打开。" };
    if (/学生/.test(text)) return { href: "/teacher/students", reply: "我的学生已打开。" };
    if (/课|考勤|点名/.test(text)) return { href: "/teacher/schedule", reply: "课表已打开。" };
    return null;
  }

  if (/报名/.test(text)) return { href: stamp("/owner/billing?form=enroll"), reply: "报名表已打开。" };
  if (/周期排课|每周排课|重复排课/.test(text)) return { href: stamp("/owner/schedule?form=recurring"), reply: "周期排课已打开。" };
  if (/排课|加课|新建课|安排课/.test(text)) return { href: stamp("/owner/schedule?form=lesson"), reply: "排课表已打开。" };
  if (/教室/.test(text) && /新|添|建/.test(text)) return { href: stamp("/owner/rooms?form=create"), reply: "添加教室已打开。" };
  if (/教室/.test(text)) return { href: "/owner/rooms", reply: "教室管理已打开。" };
  if (/学生/.test(text) && /新|添|建|录入/.test(text)) return { href: stamp("/owner/students?create=1"), reply: "新建学生已打开。" };
  if (/学生/.test(text)) return { href: "/owner/students", reply: "学生管理已打开。" };
  if (/教师|老师/.test(text) && /新|添|建/.test(text)) return { href: stamp("/owner/teachers?form=create"), reply: "新建教师已打开。" };
  if (/教师|老师/.test(text)) return { href: "/owner/teachers", reply: "教师管理已打开。" };
  if (/班级/.test(text) && /新|添|建/.test(text)) return { href: stamp("/owner/courses?form=class"), reply: "新建班级已打开。" };
  if (/课程/.test(text) && /新|添|建/.test(text)) return { href: stamp("/owner/courses?form=course"), reply: "新建课程已打开。" };
  if (/课程|班级|排队/.test(text)) return { href: "/owner/courses", reply: "课程与班级已打开。" };
  if (/报告/.test(text)) return { href: "/owner/reports", reply: "教学报告已打开。" };
  if (/考勤|点名|课表/.test(text)) return { href: "/owner/schedule", reply: "课表已打开。" };
  if (/待办/.test(text)) return { href: "/owner/todos", reply: "待办中心已打开。" };
  if (/操作记录/.test(text)) return { href: "/owner/audit", reply: "操作记录已打开。" };
  if (/统计/.test(text)) return { href: "/owner/stats", reply: "基础统计已打开。" };
  if (/设置/.test(text)) return { href: "/owner/settings", reply: "机构设置已打开。" };
  if (/工作台|首页/.test(text)) return { href: "/owner", reply: "工作台已打开。" };
  if (/课时|收款|缴费|续费/.test(text)) return { href: "/owner/billing", reply: "报名与课时已打开。" };
  return null;
}
