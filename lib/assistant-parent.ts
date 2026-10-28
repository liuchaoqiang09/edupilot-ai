/**
 * 家长端小星：Ask 查自己孩子；Agent 可请假/取消请假/回复报告/标已读。
 * 不能办教务写入、财务、全机构名单。
 */
import type OpenAI from "openai";
import { writeAudit } from "@/lib/audit";
import { dayRange, formatClock, formatDateTime, shanghaiDateKey, shiftDate } from "@/lib/datetime";
import { linkedParentChildren, parentVisibleLessonFilter } from "@/lib/parent-scope";
import { prisma } from "@/lib/prisma";
import type { AssistantMode } from "@/lib/assistant-mode";

export type ParentActor = {
  id: string;
  name: string;
  organizationId: string;
  area: "parent";
  teacherId: null;
};

export const parentPlaces = [
  "孩子概览",
  "课程安排",
  "出勤记录",
  "教学报告",
  "作业",
  "考试成绩",
  "消息通知",
  "课时与费用",
  "账号",
] as const;

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[]): OpenAI.Chat.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: { type: "object", additionalProperties: false, properties, required },
    },
  };
}

const text = (description: string) => ({ type: "string", description });

export function parentOpenExactTool(): OpenAI.Chat.ChatCompletionTool {
  return tool(
    "open_exact",
    "打开家长端某个页面。用户要请假/回复报告时不要只用本工具，应查编号后调用 execute_。",
    {
      place: { type: "string", enum: [...parentPlaces], description: "最具体的位置" },
      target: text("孩子姓名，没有就空字符串"),
    },
    ["place", "target"],
  );
}

export function parentLookupTools(): OpenAI.Chat.ChatCompletionTool[] {
  return [
    tool("list_my_children", "列出当前家长已绑定的孩子。", {}, []),
    tool("get_child_schedule", "查看已绑定孩子从今天起的课表。可按孩子姓名筛选。", { childName: text("可选，孩子姓名") }, []),
    tool("get_child_attendance", "查看已绑定孩子近 14 天出勤。", { childName: text("可选，孩子姓名") }, []),
    tool("get_child_reports", "查看已绑定孩子最近已发布报告。", { childName: text("可选，孩子姓名") }, []),
    tool("get_child_homework", "查看已绑定孩子待交或近期作业。", { childName: text("可选，孩子姓名") }, []),
    tool("get_child_courses", "查看已绑定孩子的课时与费用概况。", { childName: text("可选，孩子姓名") }, []),
    tool("get_notices_summary", "查看未读消息数量与最近几条通知标题。", {}, []),
    tool(
      "lookup_leave_seat",
      "按孩子姓名与日期（或课次关键词）查找可请假的课次名单 ID（lessonStudentId）。办理请假前先调用。",
      { childName: text("孩子姓名"), when: text("日期 YYYY-MM-DD 或课次标题关键词") },
      ["childName"],
    ),
    tool("lookup_report", "按孩子姓名查找已发布、可回复的报告 ID。", { childName: text("孩子姓名") }, ["childName"]),
  ];
}

export function parentExecuteTools(): OpenAI.Chat.ChatCompletionTool[] {
  return [
    tool(
      "execute_parent_leave",
      "发起家长请假。须先 lookup_leave_seat 得到 lessonStudentId。调用后弹出确认卡，确认才写入。",
      { lessonStudentId: text("课次名单 ID"), note: text("请假原因，可空，最多 80 字") },
      ["lessonStudentId"],
    ),
    tool(
      "execute_cancel_parent_leave",
      "取消已提交的家长请假。须先查到 lessonStudentId。",
      { lessonStudentId: text("课次名单 ID") },
      ["lessonStudentId"],
    ),
    tool(
      "execute_reply_report",
      "回复一份已发布的教学报告。须先 lookup_report。",
      { reportId: text("报告 ID"), body: text("回复内容，1 到 300 字") },
      ["reportId", "body"],
    ),
    tool("execute_mark_notices_read", "把当前家长的未读消息全部标为已读。", {}, []),
  ];
}

export function parentToolsFor(mode: AssistantMode): OpenAI.Chat.ChatCompletionTool[] {
  const read = [parentOpenExactTool(), ...parentLookupTools()];
  if (mode === "ask") return read;
  return [...read, ...parentExecuteTools()];
}

export const PARENT_ASK_TOOLS = new Set([
  "open_exact",
  "list_my_children",
  "get_child_schedule",
  "get_child_attendance",
  "get_child_reports",
  "get_child_homework",
  "get_child_courses",
  "get_notices_summary",
  "lookup_leave_seat",
  "lookup_report",
]);

export function isParentAskBlocked(name: string) {
  if (name.startsWith("execute_")) return true;
  return !PARENT_ASK_TOOLS.has(name);
}

async function childrenOf(actor: ParentActor) {
  return linkedParentChildren(actor.organizationId, actor.id);
}

async function pickChild(actor: ParentActor, childName: string) {
  const children = await childrenOf(actor);
  const keyword = childName.trim();
  if (!keyword) return { children, child: children.length === 1 ? children[0] : null };
  const hit = children.find((row) => row.name.includes(keyword) || keyword.includes(row.name));
  return { children, child: hit ?? null };
}

export async function landForParentUtterance(actor: ParentActor, text: string): Promise<{ href: string; reply: string }> {
  const compact = text.replace(/\s+/g, "");
  const place =
    /课表|课程安排|下一节|什么时候上课|请假/.test(compact) ? "课程安排"
    : /出勤|考勤|有没有来/.test(compact) ? "出勤记录"
    : /报告|学情/.test(compact) ? "教学报告"
    : /作业/.test(compact) ? "作业"
    : /考试|成绩/.test(compact) ? "考试成绩"
    : /通知|消息|未读/.test(compact) ? "消息通知"
    : /课时|费用|余额|欠费|报名/.test(compact) ? "课时与费用"
    : /账号|密码|换绑/.test(compact) ? "账号"
    : null;
  if (!place) return { href: "/parent", reply: "家长工作台已打开。" };
  const landed = await resolveParentPlace(actor, place, "");
  if (!landed.ok) return { href: "/parent", reply: landed.message };
  return { href: landed.href, reply: landed.reply };
}

export async function resolveParentPlace(actor: ParentActor, place: string, target: string) {
  const allowed = parentPlaces as readonly string[];
  if (!allowed.includes(place)) return { ok: false as const, message: "家长端只能打开自己的课表、出勤、报告、作业、通知、课时与账号。" };
  const { child } = await pickChild(actor, target);
  const who = child ? `?child=${child.id}` : "";
  if (place === "孩子概览") return { ok: true as const, href: "/parent", reply: "孩子概览已打开。" };
  if (place === "课程安排") return { ok: true as const, href: `/parent/schedule${who}`, reply: child ? `已打开${child.name}的课程安排。` : "课程安排已打开。" };
  if (place === "出勤记录") return { ok: true as const, href: `/parent/attendance${who}`, reply: child ? `已打开${child.name}的出勤。` : "出勤记录已打开。" };
  if (place === "教学报告") return { ok: true as const, href: `/parent/reports${who}`, reply: child ? `已打开${child.name}的报告。` : "教学报告已打开。" };
  if (place === "作业") return { ok: true as const, href: `/parent/homework${who}`, reply: child ? `已打开${child.name}的作业。` : "作业已打开。" };
  if (place === "考试成绩") return { ok: true as const, href: `/parent/exams${who}`, reply: "考试成绩已打开。" };
  if (place === "消息通知") return { ok: true as const, href: "/parent/notices", reply: "消息通知已打开。" };
  if (place === "课时与费用") return { ok: true as const, href: `/parent/courses${who}`, reply: child ? `已打开${child.name}的课时与费用。` : "课时与费用已打开。" };
  if (place === "账号") return { ok: true as const, href: "/parent/account", reply: "账号页已打开。" };
  return { ok: true as const, href: "/parent", reply: "家长工作台已打开。" };
}

export async function runParentTool(actor: ParentActor, name: string, args: Record<string, unknown>): Promise<string> {
  const str = (key: string) => String(args[key] ?? "").trim();

  if (name === "open_exact") {
    const landed = await resolveParentPlace(actor, str("place"), str("target"));
    if (!landed.ok) return landed.message;
    return JSON.stringify({ opened: true, href: landed.href, reply: landed.reply });
  }

  if (name === "list_my_children") {
    const children = await childrenOf(actor);
    if (children.length === 0) return "还没有绑定的孩子。请联系机构在学生档案里完成绑定。";
    return children.map((row) => `${row.name}（${row.status === "ACTIVE" ? "在读" : "已停用"}，id=${row.id}）`).join("\n");
  }

  if (name === "get_child_schedule") {
    const { children, child } = await pickChild(actor, str("childName"));
    if (children.length === 0) return "还没有绑定的孩子。";
    if (str("childName") && !child) return `没有找到名叫「${str("childName")}」的已绑定孩子。`;
    const ids = child ? [child.id] : children.map((row) => row.id);
    const start = dayRange(shanghaiDateKey()).start;
    const end = dayRange(shiftDate(shanghaiDateKey(), 14)).end;
    const rows = await prisma.lessonStudent.findMany({
      where: {
        organizationId: actor.organizationId,
        studentId: { in: ids },
        ...parentVisibleLessonFilter(),
        lessonSession: { status: { not: "CANCELLED" }, startAt: { gte: start, lt: end } },
      },
      select: {
        id: true,
        parentLeaveAt: true,
        student: { select: { name: true } },
        lessonSession: { select: { title: true, startAt: true, endAt: true, location: true, course: { select: { name: true } } } },
      },
      orderBy: { lessonSession: { startAt: "asc" } },
      take: 30,
    });
    if (rows.length === 0) return "近两周没有已安排的课次。";
    return rows
      .map((row) => {
        const leave = row.parentLeaveAt ? " · 已请假" : "";
        return `${row.student.name} · ${row.lessonSession.course.name}${row.lessonSession.title ? ` · ${row.lessonSession.title}` : ""} · ${formatDateTime(row.lessonSession.startAt)}–${formatClock(row.lessonSession.endAt)} · 名单id=${row.id}${leave}`;
      })
      .join("\n");
  }

  if (name === "get_child_attendance") {
    const { children, child } = await pickChild(actor, str("childName"));
    if (children.length === 0) return "还没有绑定的孩子。";
    if (str("childName") && !child) return `没有找到名叫「${str("childName")}」的已绑定孩子。`;
    const ids = child ? [child.id] : children.map((row) => row.id);
    const start = dayRange(shiftDate(shanghaiDateKey(), -14)).start;
    const rows = await prisma.lessonStudent.findMany({
      where: {
        organizationId: actor.organizationId,
        studentId: { in: ids },
        lessonSession: { status: { not: "CANCELLED" }, startAt: { gte: start, lt: dayRange(shanghaiDateKey()).end } },
      },
      select: {
        attendanceStatus: true,
        student: { select: { name: true } },
        lessonSession: { select: { startAt: true, course: { select: { name: true } } } },
      },
      orderBy: { lessonSession: { startAt: "desc" } },
      take: 40,
    });
    if (rows.length === 0) return "近 14 天没有出勤记录。";
    const label: Record<string, string> = { PRESENT: "出勤", LATE: "迟到", ABSENT: "缺勤", LEAVE: "请假", NOT_MARKED: "未标记" };
    return rows.map((row) => `${row.student.name} · ${row.lessonSession.course.name} · ${formatDateTime(row.lessonSession.startAt)} · ${label[row.attendanceStatus] ?? row.attendanceStatus}`).join("\n");
  }

  if (name === "get_child_reports") {
    const { children, child } = await pickChild(actor, str("childName"));
    if (children.length === 0) return "还没有绑定的孩子。";
    if (str("childName") && !child) return `没有找到名叫「${str("childName")}」的已绑定孩子。`;
    const ids = child ? [child.id] : children.map((row) => row.id);
    const rows = await prisma.teachingReport.findMany({
      where: { organizationId: actor.organizationId, studentId: { in: ids }, status: "PUBLISHED" },
      select: { id: true, summary: true, publishedAt: true, student: { select: { name: true } }, lessonSession: { select: { title: true, course: { select: { name: true } } } } },
      orderBy: { publishedAt: "desc" },
      take: 10,
    });
    if (rows.length === 0) return "还没有已发布的报告。";
    return rows
      .map((row) => `${row.student.name} · ${row.lessonSession.course.name}${row.lessonSession.title ? ` · ${row.lessonSession.title}` : ""} · id=${row.id} · ${(row.summary || "已发布").slice(0, 40)}`)
      .join("\n");
  }

  if (name === "get_child_homework") {
    const { children, child } = await pickChild(actor, str("childName"));
    if (children.length === 0) return "还没有绑定的孩子。";
    if (str("childName") && !child) return `没有找到名叫「${str("childName")}」的已绑定孩子。`;
    const ids = child ? [child.id] : children.map((row) => row.id);
    const rows = await prisma.lessonStudent.findMany({
      where: {
        organizationId: actor.organizationId,
        studentId: { in: ids },
        lessonSession: { teachingRecord: { homework: { not: null } } },
      },
      select: {
        id: true,
        studentId: true,
        student: { select: { name: true } },
        lessonSession: {
          select: {
            id: true,
            title: true,
            startAt: true,
            course: { select: { name: true } },
            teachingRecord: { select: { homework: true, homeworkDueAt: true } },
          },
        },
      },
      orderBy: { lessonSession: { startAt: "desc" } },
      take: 15,
    });
    if (rows.length === 0) return "暂时没有布置作业的课次。";
    const submissions = await prisma.homeworkSubmission.findMany({
      where: {
        organizationId: actor.organizationId,
        studentId: { in: ids },
        lessonSessionId: { in: rows.map((row) => row.lessonSession.id) },
      },
      select: { lessonSessionId: true, studentId: true, status: true },
    });
    const statusOf = new Map(submissions.map((row) => [`${row.lessonSessionId}:${row.studentId}`, row.status]));
    return rows
      .map((row) => {
        const status = statusOf.get(`${row.lessonSession.id}:${row.studentId}`) ?? "未交";
        return `${row.student.name} · ${row.lessonSession.course.name} · ${status} · 名单id=${row.id}`;
      })
      .join("\n");
  }

  if (name === "get_child_courses") {
    const { children, child } = await pickChild(actor, str("childName"));
    if (children.length === 0) return "还没有绑定的孩子。";
    if (str("childName") && !child) return `没有找到名叫「${str("childName")}」的已绑定孩子。`;
    const ids = child ? [child.id] : children.map((row) => row.id);
    const enrollments = await prisma.enrollment.findMany({
      where: { organizationId: actor.organizationId, studentId: { in: ids } },
      select: {
        status: true,
        hoursAdded: true,
        amountDue: true,
        amount: true,
        student: { select: { name: true } },
        course: { select: { name: true, billingType: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    const balances = await prisma.courseHourBalance.findMany({
      where: { organizationId: actor.organizationId, studentId: { in: ids } },
      select: { remainingHours: true, student: { select: { name: true } }, course: { select: { name: true } } },
    });
    if (enrollments.length === 0 && balances.length === 0) return "还没有报名或课时记录。";
    const payLabel: Record<string, string> = { PAID: "已结清", PARTIAL: "部分收款", UNPAID: "未收款" };
    const lines = [
      ...enrollments.map((row) => {
        const hours = row.course.billingType === "PER_LESSON" ? ` · 买入${row.hoursAdded}节` : "";
        return `${row.student.name} · ${row.course.name} · ${payLabel[row.status] ?? row.status} · 应收${String(row.amountDue)}实收${String(row.amount)}${hours}`;
      }),
      ...balances.map((row) => `${row.student.name} · ${row.course.name} · 剩余 ${row.remainingHours} 节`),
    ];
    return lines.join("\n");
  }

  if (name === "get_notices_summary") {
    const unread = await prisma.parentNotice.count({
      where: { organizationId: actor.organizationId, parentUserId: actor.id, readAt: null },
    });
    const recent = await prisma.parentNotice.findMany({
      where: { organizationId: actor.organizationId, parentUserId: actor.id },
      select: { title: true, kind: true, readAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    if (recent.length === 0) return `未读 ${unread} 条。暂时没有通知。`;
    return [`未读 ${unread} 条。`, ...recent.map((row) => `${row.readAt ? "已读" : "未读"} · ${row.title}`)].join("\n");
  }

  if (name === "lookup_leave_seat") {
    const { child } = await pickChild(actor, str("childName"));
    if (!child) return "请先确认已绑定孩子的姓名。";
    if (child.status !== "ACTIVE") return `${child.name}已停用，不能请假。`;
    const when = str("when");
    const start = dayRange(shanghaiDateKey()).start;
    const end = dayRange(shiftDate(shanghaiDateKey(), 21)).end;
    const rows = await prisma.lessonStudent.findMany({
      where: {
        organizationId: actor.organizationId,
        studentId: child.id,
        parentLeaveAt: null,
        lessonSession: {
          status: { not: "CANCELLED" },
          startAt: { gt: new Date(), gte: start, lt: end },
          ...(when && !/^\d{4}-\d{2}-\d{2}$/.test(when)
            ? { OR: [{ title: { contains: when } }, { course: { name: { contains: when } } }] }
            : when
              ? { startAt: { gte: dayRange(when).start, lt: dayRange(when).end } }
              : {}),
        },
      },
      select: {
        id: true,
        lessonSession: { select: { title: true, startAt: true, endAt: true, course: { select: { name: true } } } },
      },
      orderBy: { lessonSession: { startAt: "asc" } },
      take: 10,
    });
    if (rows.length === 0) return "没有找到可请假的未来课次（可能已开始、已请假或已取消）。";
    return rows
      .map((row) => `${child.name} · ${row.lessonSession.course.name}${row.lessonSession.title ? ` · ${row.lessonSession.title}` : ""} · ${formatDateTime(row.lessonSession.startAt)} · lessonStudentId=${row.id}`)
      .join("\n");
  }

  if (name === "lookup_report") {
    const { child } = await pickChild(actor, str("childName"));
    if (!child) return "请先确认已绑定孩子的姓名。";
    const rows = await prisma.teachingReport.findMany({
      where: { organizationId: actor.organizationId, studentId: child.id, status: "PUBLISHED" },
      select: { id: true, summary: true, publishedAt: true, lessonSession: { select: { title: true, course: { select: { name: true } } } } },
      orderBy: { publishedAt: "desc" },
      take: 8,
    });
    if (rows.length === 0) return `${child.name}还没有已发布报告。`;
    return rows
      .map((row) => `${child.name} · ${row.lessonSession.course.name} · reportId=${row.id} · ${(row.summary || "").slice(0, 36)}`)
      .join("\n");
  }

  return "家长端小星不能执行这个操作。";
}

export type ParentPreview =
  | { ok: true; summary: string; detail: string; args: Record<string, string>; href: string }
  | { ok: false; message: string };

export async function previewParentWrite(actor: ParentActor, name: string, args: Record<string, unknown>): Promise<ParentPreview> {
  const str = (key: string) => String(args[key] ?? "").trim();

  if (name === "execute_parent_leave") {
    const lessonStudentId = str("lessonStudentId");
    const note = str("note").slice(0, 80);
    const row = await prisma.lessonStudent.findFirst({
      where: { id: lessonStudentId, organizationId: actor.organizationId, student: { parentLinks: { some: { parentUserId: actor.id } } } },
      select: {
        id: true,
        parentLeaveAt: true,
        hoursCharged: true,
        student: { select: { name: true, status: true } },
        lessonSession: { select: { startAt: true, status: true, title: true, course: { select: { name: true } } } },
      },
    });
    if (!row || row.lessonSession.status === "CANCELLED") return { ok: false, message: "找不到这节课，或课次已取消。" };
    if (row.student.status !== "ACTIVE") return { ok: false, message: "孩子已停用，不能请假。" };
    if (row.lessonSession.startAt.getTime() <= Date.now()) return { ok: false, message: "课次已经开始，不能再请假。" };
    if (row.hoursCharged) return { ok: false, message: "老师已保存考勤，不能再请假。" };
    if (row.parentLeaveAt) return { ok: false, message: "已经提交过请假。" };
    return {
      ok: true,
      summary: `小星助教准备为【${row.student.name}】请假：【${row.lessonSession.course.name}${row.lessonSession.title ? ` · ${row.lessonSession.title}` : ""}】，是否确认？`,
      detail: note ? `原因：${note}` : "未填写原因时将记为「家长请假」。",
      args: { lessonStudentId: row.id, note },
      href: "/parent/schedule",
    };
  }

  if (name === "execute_cancel_parent_leave") {
    const lessonStudentId = str("lessonStudentId");
    const row = await prisma.lessonStudent.findFirst({
      where: {
        id: lessonStudentId,
        organizationId: actor.organizationId,
        parentLeaveAt: { not: null },
        student: { parentLinks: { some: { parentUserId: actor.id } } },
      },
      select: {
        id: true,
        student: { select: { name: true } },
        lessonSession: { select: { startAt: true, title: true, course: { select: { name: true } } } },
        makeups: { select: { id: true } },
      },
    });
    if (!row) return { ok: false, message: "找不到已提交的请假。" };
    if (row.lessonSession.startAt.getTime() <= Date.now()) return { ok: false, message: "课次已开始，不能取消请假。" };
    if (row.makeups.length > 0) return { ok: false, message: "已安排补课，不能取消请假。" };
    return {
      ok: true,
      summary: `小星助教准备取消【${row.student.name}】的请假：【${row.lessonSession.course.name}】，是否确认？`,
      detail: "取消后老师会看到未请假状态。",
      args: { lessonStudentId: row.id },
      href: "/parent/schedule",
    };
  }

  if (name === "execute_reply_report") {
    const reportId = str("reportId");
    const body = str("body");
    if (body.length < 1 || body.length > 300) return { ok: false, message: "回复内容需要 1 到 300 个字。" };
    const report = await prisma.teachingReport.findFirst({
      where: {
        id: reportId,
        organizationId: actor.organizationId,
        status: "PUBLISHED",
        student: { parentLinks: { some: { parentUserId: actor.id } } },
      },
      select: { id: true, student: { select: { name: true } }, lessonSession: { select: { course: { select: { name: true } } } } },
    });
    if (!report) return { ok: false, message: "找不到可回复的已发布报告。" };
    return {
      ok: true,
      summary: `小星助教准备回复【${report.student.name}】的【${report.lessonSession.course.name}】报告，是否确认？`,
      detail: body,
      args: { reportId: report.id, body },
      href: "/parent/reports",
    };
  }

  if (name === "execute_mark_notices_read") {
    const unread = await prisma.parentNotice.count({
      where: { organizationId: actor.organizationId, parentUserId: actor.id, readAt: null },
    });
    if (unread === 0) return { ok: false, message: "目前没有未读消息。" };
    return {
      ok: true,
      summary: `小星助教准备将 ${unread} 条未读消息标为已读，是否确认？`,
      detail: "只影响当前家长账号的消息已读状态。",
      args: {},
      href: "/parent/notices",
    };
  }

  return { ok: false, message: "家长端不能执行这个操作。" };
}

export async function executeParentWrite(actor: ParentActor, name: string, args: Record<string, string>) {
  if (name === "execute_parent_leave") {
    const note = (args.note || "家长请假").slice(0, 80);
    const row = await prisma.lessonStudent.findFirst({
      where: { id: args.lessonStudentId, organizationId: actor.organizationId, student: { parentLinks: { some: { parentUserId: actor.id } } } },
      select: {
        id: true,
        student: { select: { name: true } },
        lessonSession: { select: { startAt: true, status: true, title: true, course: { select: { name: true } } } },
      },
    });
    if (!row || row.lessonSession.status === "CANCELLED") return { ok: false as const, message: "找不到这节课。" };
    if (row.lessonSession.startAt.getTime() <= Date.now()) return { ok: false as const, message: "课次已经开始。" };
    await prisma.$transaction(async (tx) => {
      await tx.lessonStudent.update({
        where: { id: row.id },
        data: {
          attendanceStatus: "LEAVE",
          leaveKind: "PERSONAL",
          attendanceNote: note,
          parentLeaveAt: new Date(),
          parentLeaveNote: note,
          lastAction: "家长请假",
        },
      });
      await writeAudit(tx, {
        organizationId: actor.organizationId,
        actorId: actor.id,
        action: "PARENT_LEAVE",
        targetType: "LessonStudent",
        targetId: row.id,
        detail: `${actor.name}为${row.student.name}请假：${row.lessonSession.course.name}`,
      });
    });
    return { ok: true as const, message: `已为${row.student.name}提交请假。` };
  }

  if (name === "execute_cancel_parent_leave") {
    const row = await prisma.lessonStudent.findFirst({
      where: {
        id: args.lessonStudentId,
        organizationId: actor.organizationId,
        parentLeaveAt: { not: null },
        student: { parentLinks: { some: { parentUserId: actor.id } } },
      },
      select: { id: true, student: { select: { name: true } }, lessonSession: { select: { startAt: true } }, makeups: { select: { id: true } } },
    });
    if (!row) return { ok: false as const, message: "找不到已提交的请假。" };
    if (row.lessonSession.startAt.getTime() <= Date.now()) return { ok: false as const, message: "课次已开始。" };
    if (row.makeups.length > 0) return { ok: false as const, message: "已安排补课，不能取消。" };
    await prisma.$transaction(async (tx) => {
      await tx.lessonStudent.update({
        where: { id: row.id },
        data: {
          attendanceStatus: "NOT_MARKED",
          leaveKind: null,
          attendanceNote: null,
          parentLeaveAt: null,
          parentLeaveNote: null,
          lastAction: "取消家长请假",
        },
      });
      await writeAudit(tx, {
        organizationId: actor.organizationId,
        actorId: actor.id,
        action: "PARENT_LEAVE_CANCEL",
        targetType: "LessonStudent",
        targetId: row.id,
        detail: `${actor.name}取消了${row.student.name}的请假`,
      });
    });
    return { ok: true as const, message: `已取消${row.student.name}的请假。` };
  }

  if (name === "execute_reply_report") {
    const body = (args.body || "").trim();
    if (body.length < 1 || body.length > 300) return { ok: false as const, message: "回复内容需要 1 到 300 个字。" };
    const report = await prisma.teachingReport.findFirst({
      where: {
        id: args.reportId,
        organizationId: actor.organizationId,
        status: "PUBLISHED",
        student: { parentLinks: { some: { parentUserId: actor.id } } },
      },
      select: { id: true, studentId: true, student: { select: { name: true } } },
    });
    if (!report) return { ok: false as const, message: "找不到可回复的报告。" };
    await prisma.reportReply.upsert({
      where: { reportId_parentUserId: { reportId: report.id, parentUserId: actor.id } },
      create: { organizationId: actor.organizationId, reportId: report.id, parentUserId: actor.id, body },
      update: { body },
    });
    return { ok: true as const, message: `已回复${report.student.name}的报告。` };
  }

  if (name === "execute_mark_notices_read") {
    const result = await prisma.parentNotice.updateMany({
      where: { organizationId: actor.organizationId, parentUserId: actor.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true as const, message: result.count === 0 ? "没有未读消息。" : `已将 ${result.count} 条消息标为已读。` };
  }

  return { ok: false as const, message: "家长端不能执行这个操作。" };
}
