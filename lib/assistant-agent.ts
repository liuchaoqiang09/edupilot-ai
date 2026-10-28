import { createHmac, timingSafeEqual } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { revalidatePath } from "next/cache";
import OpenAI from "openai";
import type { CurrentUser } from "@/lib/auth";
import { adjustLessonHours } from "@/lib/billing-ledger";
import { arrearsCents, decimalCents } from "@/lib/enrollment-money";
import { calendarDateKey, CourseHourError, periodValidity } from "@/lib/course-hours";
import { formatClock, formatDateTime, parseShanghaiDateTime, shanghaiDateKey } from "@/lib/datetime";
import { findScheduleConflicts, roomCapacityWarning, singleConflictWarning, type ExistingLesson } from "@/lib/lesson-conflicts";
import { prisma } from "@/lib/prisma";
import { publishReportByTeacher } from "@/lib/report-flow";
import { reportStatusLabel } from "@/lib/report-labels";
import { executeOperation, executeTools, lookupTools, operationWrites, previewOperation, routeExecute, runOperationRead } from "@/lib/assistant-ops";
import {
  executeParentWrite,
  landForParentUtterance,
  parentToolsFor,
  previewParentWrite,
  resolveParentPlace,
  runParentTool,
  type ParentActor,
} from "@/lib/assistant-parent";
import { landForUtterance, locateWork, openExactTool, queueIntent, resolveExactPlace, screenIntent, screenStudentsTool } from "@/lib/assistant-places";
import {
  askModeBlockedMessage,
  helpIntent,
  modeContractPrompt,
  parseAssistantMode,
  type AssistantMode,
  isAskBlockedTool,
} from "@/lib/assistant-mode";
export { helpIntent };
import { assertAssistantMayExecute, assistantForbiddenMessage } from "@/lib/assistant-policy";

export const assistantTimeoutMessage = "小星助教思考超时，请稍后再试";
export { parseAssistantMode };
export type { AssistantMode };

const skillPath = join(process.cwd(), ".cursor/skills/xiaoxing-assistant/SKILL.md");
const skillFallback = "你是机构里的教务长。问答模式只查与打开；工作模式先查编号再 execute_。三禁：删除、财务写、账号写。不要编造编号和金额。";

function assistantSkill() {
  try {
    const raw = readFileSync(skillPath, "utf8");
    const body = raw.replace(/^---[\s\S]*?---\s*/, "").trim();
    return body || skillFallback;
  } catch {
    return skillFallback;
  }
}

const parentWriteTools = new Set([
  "execute_parent_leave",
  "execute_cancel_parent_leave",
  "execute_reply_report",
  "execute_mark_notices_read",
]);

const writeTools = new Set([
  "adjust_student_hours",
  "adjust_hours",
  "create_lesson",
  "schedule_single_lesson",
  "publish_report",
  ...operationWrites,
  ...parentWriteTools,
]);

function canonicalWrite(name: string) {
  if (name === "adjust_hours") return "adjust_student_hours";
  if (name === "schedule_single_lesson") return "create_lesson";
  return name;
}

type Area = "owner" | "teacher" | "parent";

type Actor = {
  id: string;
  name: string;
  organizationId: string;
  area: Area;
  teacherId: string | null;
};

function asParent(actor: Actor): ParentActor {
  return { id: actor.id, name: actor.name, organizationId: actor.organizationId, area: "parent", teacherId: null };
}

function asStaff(actor: Actor) {
  return {
    id: actor.id,
    name: actor.name,
    organizationId: actor.organizationId,
    area: actor.area === "teacher" ? ("teacher" as const) : ("owner" as const),
    teacherId: actor.teacherId,
  };
}

type ConfirmPayload = {
  exp: number;
  userId: string;
  organizationId: string;
  area: Area;
  teacherId: string | null;
  tool: string;
  args: Record<string, string | number>;
};

export type AgentReply =
  | { ok: true; type: "message"; content: string }
  | { ok: true; type: "navigate"; content: string; navigation: { href: string } }
  | { ok: true; type: "confirm"; content: string; confirmation: { token: string; summary: string; detail: string; href: string; fields: { label: string; value: string }[] } }
  | { ok: false; message: string };

const readTools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_student",
      description: "按姓名查找学生，返回学生 ID、班级和各课程剩余课时。教师只能查到自己教的学生。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { name: { type: "string", description: "学生姓名，至少 1 个字" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_student_recent_reports",
      description: "查看一名学生最近 3 份教学报告。需要先用 search_student 得到学生 ID。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { studentId: { type: "string", description: "学生 ID" } },
        required: ["studentId"],
      },
    },
  },
];

const overdueTool: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "get_overdue_students",
    description: "查询当前机构欠费、课时用完或课程已过期的在读学生。仅机构负责人可以调用。",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
};

const mutationTools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "adjust_hours",
      description: "准备调整按课时课程的剩余课时。调用后不会立刻写入，系统会请用户确认。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          studentId: { type: "string" },
          courseId: { type: "string" },
          deltaHours: { type: "integer", description: "正数增加，负数减少，不能为 0，范围 -500 到 500" },
          reason: { type: "string", description: "1 到 80 个字的原因" },
        },
        required: ["studentId", "courseId", "deltaHours", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "schedule_single_lesson",
      description: "准备为一节已有班级排一节课。调用后不会立刻写入，系统会请用户确认。教师只能排自己负责的班。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          classGroupId: { type: "string", description: "班级 ID" },
          startAt: { type: "string", description: "上海时间，格式 2026-10-30T16:00" },
          endAt: { type: "string", description: "上海时间，格式 2026-10-30T17:30" },
          classroom: { type: "string", description: "教室 ID 或教室名称" },
        },
        required: ["classGroupId", "startAt", "endAt", "classroom"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "publish_report",
      description: "准备发布一份已经确认的教学报告。调用后不会立刻写入，系统会请用户确认。只有这节课的授课教师能发布。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { reportId: { type: "string" } },
        required: ["reportId"],
      },
    },
  },
];

function toolsFor(actor: Actor, mode: AssistantMode) {
  if (actor.area === "parent") return parentToolsFor(mode);
  const staff = { ...actor, area: actor.area === "teacher" ? ("teacher" as const) : ("owner" as const) };
  const base = staff.area === "owner" ? [...readTools, overdueTool] : readTools;
  const readSide = [screenStudentsTool(), openExactTool(staff.area), ...base, ...lookupTools(staff)];
  if (mode === "ask") return readSide;
  return [...readSide, ...executeTools(staff)];
}

async function answerAndOpen(actor: Actor, text: string, content: string, mode: AssistantMode): Promise<AgentReply> {
  if (text.startsWith("系统已执行")) return { ok: true, type: "message", content };
  if (actor.area === "parent") {
    const home = "/parent";
    const compact = text.replace(/\s+/g, "");
    const wantsOpen = /^(打开|带我去|去看|我想看|查看|跳转)/.test(compact) || /打开|带我去/.test(compact);
    const landed = await landForParentUtterance(asParent(actor), text);
    if (mode === "ask" && !wantsOpen) {
      if (!landed.href || landed.href === home || landed.href.startsWith(`${home}?`)) {
        return { ok: true, type: "message", content };
      }
      return { ok: true, type: "navigate", content, navigation: { href: landed.href } };
    }
    return { ok: true, type: "navigate", content, navigation: { href: landed.href } };
  }
  const staff = asStaff(actor);
  const home = staff.area === "teacher" ? "/teacher" : "/owner";
  const compact = text.replace(/\s+/g, "");
  const wantsOpen = /^(打开|带我去|去看|我想看|查看|跳转)/.test(compact) || /打开|带我去|名单页|流水页/.test(compact);
  // 问答模式默认只回话；除非用户明确要打开，或落地页不是工作台首页。
  if (mode === "ask" && !wantsOpen) {
    const landed = await landForUtterance(staff, text);
    if (!landed.href || landed.href === home || landed.href.startsWith(`${home}?`)) {
      return { ok: true, type: "message", content };
    }
    return { ok: true, type: "navigate", content, navigation: { href: landed.href } };
  }
  const landed = await landForUtterance(staff, text);
  return { ok: true, type: "navigate", content, navigation: { href: landed.href } };
}

function pageFor(area: Area, tool: string) {
  if (area === "parent") {
    if (tool.includes("report") || tool === "execute_reply_report") return "/parent/reports";
    if (tool.includes("notice")) return "/parent/notices";
    if (tool.includes("leave")) return "/parent/schedule";
    return "/parent";
  }
  const owner = area === "owner";
  if (["create_enrollment", "record_payment", "adjust_student_hours", "add_follow_up", "stop_enrollment"].includes(tool)) return owner ? "/owner/billing" : "/teacher";
  if (["create_lesson", "schedule_recurring_lessons", "change_lesson_time", "change_lesson_classroom", "change_lesson_teacher", "cancel_lesson", "make_up_lesson", "add_lesson_student"].includes(tool)) return owner ? "/owner/schedule" : "/teacher/schedule";
  if (tool === "mark_attendance") return owner ? "/owner/schedule" : "/teacher/attendance";
  if (["generate_ai_report", "publish_report", "return_report"].includes(tool)) return owner ? "/owner/reports" : "/teacher/reports";
  if (tool.startsWith("create_student") || tool.includes("student") || tool === "bind_parent" || tool === "update_student" || tool === "set_student_status") return owner ? "/owner/students" : "/teacher/students";
  if (tool.includes("teacher") || tool === "assign_course_to_teacher" || tool === "issue_teacher_invite") return "/owner/teachers";
  if (tool.includes("class") || tool.includes("course") || tool.includes("wait")) return "/owner/courses";
  if (tool.includes("room") || tool.includes("classroom")) return "/owner/rooms";
  if (tool === "update_organization") return "/owner/settings";
  return owner ? "/owner" : "/teacher";
}

function confirmFields(summary: string, detail: string) {
  const values = [...summary.matchAll(/【([^】]+)】/g)].map((item) => item[1]);
  const due = summary.match(/应收\s*([^，元\s]+)/);
  const paid = summary.match(/实收\s*([^，元\s]+)/);
  const amount = summary.match(/(\d+(?:\.\d{1,2})?)\s*元/);
  const hours = summary.match(/([+-]?\d+)\s*节/);
  const rows: { label: string; value: string }[] = [];
  const aboutStudent = /报名|课时|跟进|排队|考勤|补课/.test(summary);
  const first = aboutStudent ? "学生" : summary.includes("教师") ? "教师" : summary.includes("教室") ? "教室" : summary.includes("班级") ? "班级" : "对象";
  const second = /报名|课时|课程/.test(summary) ? "课程" : summary.includes("考勤") ? "状态" : "项目";
  if (values[0]) rows.push({ label: first, value: values[0] });
  if (values[1]) rows.push({ label: second, value: values[1] });
  if (values[2]) rows.push({ label: summary.includes("方式") ? "收款方式" : summary.includes("原因") ? "原因" : "补充", value: values[2] });
  if (hours) rows.push({ label: "数量", value: `${hours[1]}节` });
  if (due) rows.push({ label: "应收", value: `${due[1]}元` });
  if (paid) rows.push({ label: "实收", value: `${paid[1]}元` });
  else if (amount && !due) rows.push({ label: "金额", value: `${amount[1]}元` });
  for (const value of values.slice(3)) rows.push({ label: "内容", value });
  if (detail.trim()) rows.push({ label: "说明", value: detail.trim() });
  if (rows.length === 0) rows.push({ label: "操作", value: summary.replace(/，?是否确认执行？/g, "").trim() });
  return rows;
}

function refreshAssistant() {
  revalidatePath("/owner");
  revalidatePath("/owner/schedule");
  revalidatePath("/owner/billing");
  revalidatePath("/owner/reports");
  revalidatePath("/teacher");
  revalidatePath("/teacher/schedule");
  revalidatePath("/teacher/records");
  revalidatePath("/teacher/reports");
  revalidatePath("/parent");
  revalidatePath("/parent/reports");
  revalidatePath("/parent/schedule");
  revalidatePath("/parent/notices");
  revalidatePath("/parent/homework");
  revalidatePath("/parent/courses");
  revalidatePath("/parent/attendance");
}

function secret() {
  const value = process.env.AUTH_SECRET?.trim();
  if (!value) throw new Error("missing-secret");
  return value;
}

function sign(payload: ConfirmPayload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function readToken(token: string): ConfirmPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ConfirmPayload;
    if (!payload || payload.exp < Date.now()) return null;
    if (!writeTools.has(payload.tool)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function actorFor(user: CurrentUser, area: Area): Promise<Actor | null> {
  if (area === "owner") {
    if (!user.roles.includes("OWNER")) return null;
    return { id: user.id, name: user.name, organizationId: user.organizationId, area, teacherId: null };
  }
  if (area === "parent") {
    if (!user.roles.includes("PARENT")) return null;
    return { id: user.id, name: user.name, organizationId: user.organizationId, area, teacherId: null };
  }
  if (!user.roles.includes("TEACHER")) return null;
  const teacher = await prisma.teacher.findFirst({
    where: { userId: user.id, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  return { id: user.id, name: user.name, organizationId: user.organizationId, area, teacherId: teacher?.id ?? null };
}

async function taughtStudentIds(actor: Actor) {
  if (!actor.teacherId) return new Set<string>();
  const [enrolled, seated] = await Promise.all([
    prisma.enrollment.findMany({
      where: { organizationId: actor.organizationId, classGroup: { teacherId: actor.teacherId } },
      select: { studentId: true },
    }),
    prisma.lessonStudent.findMany({
      where: { organizationId: actor.organizationId, lessonSession: { teacherId: actor.teacherId, organizationId: actor.organizationId } },
      select: { studentId: true },
    }),
  ]);
  return new Set([...enrolled, ...seated].map((row) => row.studentId));
}

async function studentAllowed(actor: Actor, studentId: string) {
  if (actor.area === "owner") {
    const student = await prisma.student.findFirst({
      where: { id: studentId, organizationId: actor.organizationId },
      select: { id: true },
    });
    return Boolean(student);
  }
  const ids = await taughtStudentIds(actor);
  return ids.has(studentId);
}

function clip(value: string, max: number) {
  const text = value.trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

async function searchStudent(actor: Actor, name: string) {
  const keyword = name.trim();
  if (!keyword) return "请提供学生姓名。";
  const taught = actor.area === "teacher" ? await taughtStudentIds(actor) : null;
  if (taught && taught.size === 0) return "没有找到这个姓名的学生。";
  const rows = await prisma.student.findMany({
    where: {
      organizationId: actor.organizationId,
      status: "ACTIVE",
      name: { contains: keyword, mode: "insensitive" },
      ...(taught ? { id: { in: [...taught] } } : {}),
    },
    select: {
      id: true,
      name: true,
      studentNo: true,
      enrollments: {
        select: {
          courseId: true,
          classGroup: { select: { id: true, name: true } },
          course: { select: { id: true, name: true, billingType: true } },
        },
      },
    },
    orderBy: { name: "asc" },
    take: 8,
  });
  if (rows.length === 0) return "没有找到这个姓名的学生。";
  const balances = await prisma.courseHourBalance.findMany({
    where: { organizationId: actor.organizationId, studentId: { in: rows.map((row) => row.id) } },
    select: { studentId: true, courseId: true, remainingHours: true },
  });
  const hours = new Map(balances.map((row) => [`${row.studentId}:${row.courseId}`, row.remainingHours]));
  return JSON.stringify(rows.map((row) => ({
    id: row.id,
    name: row.name,
    studentNo: row.studentNo,
    classes: [...new Map(row.enrollments.flatMap((item) => item.classGroup ? [[item.classGroup.id, { id: item.classGroup.id, name: item.classGroup.name }]] : [])).values()],
    courses: [...new Map(row.enrollments.map((item) => [item.courseId, {
      id: item.course.id,
      name: item.course.name,
      remainingHours: item.course.billingType === "PER_LESSON" ? hours.get(`${row.id}:${item.courseId}`) ?? 0 : null,
    }])).values()],
  })));
}

async function recentReports(actor: Actor, studentId: string) {
  if (!(await studentAllowed(actor, studentId))) return "没有找到这名学生的报告。";
  const rows = await prisma.teachingReport.findMany({
    where: {
      organizationId: actor.organizationId,
      studentId,
      ...(actor.area === "teacher" && actor.teacherId ? { lessonSession: { teacherId: actor.teacherId } } : {}),
    },
    orderBy: { lessonSession: { startAt: "desc" } },
    take: 3,
    select: {
      id: true,
      status: true,
      summary: true,
      lessonSession: { select: { title: true, startAt: true } },
    },
  });
  if (rows.length === 0) return "这名学生最近没有报告。";
  return JSON.stringify(rows.map((row) => ({
    id: row.id,
    status: reportStatusLabel[row.status],
    lesson: row.lessonSession.title ?? "课次",
    when: formatDateTime(row.lessonSession.startAt),
    summary: clip(row.summary, 120),
  })));
}

async function overdueStudents(actor: Actor) {
  if (actor.area !== "owner") return "当前账号不能查询欠费和过期名单。";
  const today = shanghaiDateKey();
  const [enrollments, balances] = await Promise.all([
    prisma.enrollment.findMany({
      where: { organizationId: actor.organizationId, student: { status: "ACTIVE" } },
      select: {
        studentId: true,
        courseId: true,
        amountDue: true,
        discountPercent: true,
        startDate: true,
        endDate: true,
        student: { select: { name: true, studentNo: true } },
        course: { select: { name: true, billingType: true } },
        payments: { where: { voidedAt: null }, select: { amount: true } },
      },
    }),
    prisma.courseHourBalance.findMany({
      where: { organizationId: actor.organizationId },
      select: { studentId: true, courseId: true, remainingHours: true },
    }),
  ]);
  const hours = new Map(balances.map((row) => [`${row.studentId}:${row.courseId}`, row.remainingHours]));
  const windows = new Map<string, { start: string; end: string }[]>();
  for (const row of enrollments) {
    if (row.course.billingType !== "PER_PERIOD" || !row.startDate || !row.endDate) continue;
    const key = `${row.studentId}:${row.courseId}`;
    windows.set(key, [...(windows.get(key) ?? []), { start: calendarDateKey(row.startDate), end: calendarDateKey(row.endDate) }]);
  }
  const seen = new Set<string>();
  const lines: { name: string; studentNo: string | null; course: string; reason: string }[] = [];
  for (const row of enrollments) {
    const key = `${row.studentId}:${row.courseId}`;
    if (seen.has(key)) continue;
    const due = decimalCents(row.amountDue);
    const net = row.payments.reduce((sum, payment) => sum + decimalCents(payment.amount), 0);
    const discount = row.discountPercent == null ? null : Number(row.discountPercent);
    const reasons: string[] = [];
    if (arrearsCents(due, net, discount) > 0) reasons.push("欠费");
    if (row.course.billingType === "PER_PERIOD") {
      const period = periodValidity(windows.get(key) ?? [], today);
      if (period.status === "已过期") reasons.push("已过期");
    } else if ((hours.get(key) ?? 0) === 0) {
      reasons.push("无课时");
    }
    if (reasons.length === 0) continue;
    seen.add(key);
    lines.push({ name: row.student.name, studentNo: row.student.studentNo, course: row.course.name, reason: reasons.join("、") });
    if (lines.length >= 30) break;
  }
  if (lines.length === 0) return "没有欠费、无课时或已过期的在读学生。";
  return JSON.stringify(lines);
}

async function lessonsInWindow(organizationId: string, startAt: Date, endAt: Date, studentIds: string[]): Promise<ExistingLesson[]> {
  const rows = await prisma.lessonSession.findMany({
    where: { organizationId, status: { not: "CANCELLED" }, startAt: { lt: endAt }, endAt: { gt: startAt } },
    select: {
      id: true,
      title: true,
      startAt: true,
      endAt: true,
      teacherId: true,
      classGroupId: true,
      location: true,
      classroomId: true,
      students: {
        where: { studentId: { in: studentIds.length > 0 ? studentIds : ["__none__"] } },
        select: { studentId: true, student: { select: { name: true, studentNo: true } } },
      },
    },
  });
  return rows.map((lesson) => ({
    id: lesson.id,
    title: lesson.title,
    startAt: lesson.startAt,
    endAt: lesson.endAt,
    teacherId: lesson.teacherId,
    classGroupId: lesson.classGroupId,
    location: lesson.location,
    classroomId: lesson.classroomId,
    students: lesson.students.map((row) => ({ id: row.studentId, name: row.student.name, studentNo: row.student.studentNo })),
  }));
}

type Preview =
  | { ok: false; message: string }
  | { ok: true; summary: string; detail: string; args: Record<string, string | number> };

async function previewAdjust(actor: Actor, args: Record<string, unknown>): Promise<Preview> {
  const studentId = typeof args.studentId === "string" ? args.studentId.trim() : "";
  const courseId = typeof args.courseId === "string" ? args.courseId.trim() : "";
  const deltaHours = typeof args.deltaHours === "number" ? args.deltaHours : Number(args.deltaHours);
  const reason = typeof args.reason === "string" ? args.reason.trim() : "";
  if (!studentId || !courseId) return { ok: false, message: "请先用查询结果里的学生 ID 和课程 ID。" };
  if (!Number.isInteger(deltaHours) || deltaHours === 0 || Math.abs(deltaHours) > 500) return { ok: false, message: "增减节数需要是 -500 到 500 之间、且不为 0 的整数。" };
  if (!reason || reason.length > 80) return { ok: false, message: "请填写 1 到 80 个字的原因。" };
  if (!(await studentAllowed(actor, studentId))) return { ok: false, message: "没有找到这名学生，或你不能调整这名学生的课时。" };
  if (actor.area === "teacher") {
    const ownCourse = await prisma.classGroup.findFirst({
      where: { organizationId: actor.organizationId, teacherId: actor.teacherId ?? "__none__", courseId, enrollments: { some: { studentId } } },
      select: { id: true },
    }) ?? await prisma.lessonSession.findFirst({
      where: { organizationId: actor.organizationId, teacherId: actor.teacherId ?? "__none__", courseId, students: { some: { studentId } } },
      select: { id: true },
    });
    if (!ownCourse) return { ok: false, message: "只能调整自己所教课程的课时。" };
  }
  const student = await prisma.student.findFirst({
    where: { id: studentId, organizationId: actor.organizationId, status: "ACTIVE" },
    select: { name: true },
  });
  const course = await prisma.course.findFirst({
    where: { id: courseId, organizationId: actor.organizationId, billingType: "PER_LESSON" },
    select: { name: true },
  });
  const enrolled = await prisma.enrollment.findFirst({
    where: { organizationId: actor.organizationId, studentId, courseId },
    select: { id: true },
  });
  if (!student || !course || !enrolled) return { ok: false, message: "这名学生没有报名这门按课时的课程。" };
  const direction = deltaHours > 0 ? `增加 ${deltaHours} 节课` : `减少 ${-deltaHours} 节课`;
  return {
    ok: true,
    summary: `小星助教准备为【${student.name}】的【${course.name}】${direction}，原因【${reason}】，是否确认执行？`,
    detail: "",
    args: { studentId, courseId, deltaHours, reason },
  };
}

async function resolveClassroom(actor: Actor, classroom: string) {
  const value = classroom.trim();
  if (!value) return { error: "请填写教室。" as const, room: null };
  const byId = await prisma.classroom.findFirst({
    where: { id: value, organizationId: actor.organizationId, available: true },
    select: { id: true, name: true, capacity: true },
  });
  if (byId) return { error: null, room: byId };
  const byName = await prisma.classroom.findMany({
    where: { organizationId: actor.organizationId, available: true, name: value },
    select: { id: true, name: true, capacity: true },
    take: 2,
  });
  if (byName.length === 1) return { error: null, room: byName[0] };
  const names = await prisma.classroom.findMany({
    where: { organizationId: actor.organizationId, available: true },
    select: { name: true },
    orderBy: { name: "asc" },
    take: 20,
  });
  return { error: `没有唯一对应的可用教室。可用教室有：${names.map((room) => room.name).join("、") || "无"}。` as const, room: null };
}

async function previewLesson(actor: Actor, args: Record<string, unknown>): Promise<Preview> {
  const classGroupId = typeof args.classGroupId === "string" ? args.classGroupId.trim() : "";
  const startAt = parseShanghaiDateTime(typeof args.startAt === "string" ? args.startAt.trim() : "");
  const endAt = parseShanghaiDateTime(typeof args.endAt === "string" ? args.endAt.trim() : "");
  const classroom = typeof args.classroom === "string" ? args.classroom : "";
  if (!classGroupId || !startAt || !endAt || endAt <= startAt) return { ok: false, message: "请提供班级 ID，以及晚于开始时间的结束时间。时间格式是 2026-10-30T16:00。" };
  const classGroup = await prisma.classGroup.findFirst({
    where: { id: classGroupId, organizationId: actor.organizationId, status: "ACTIVE" },
    select: { id: true, name: true, courseId: true, teacherId: true, course: { select: { name: true } }, teacher: { select: { id: true, status: true } } },
  });
  if (!classGroup) return { ok: false, message: "只能为当前机构启用中的班级排课。" };
  if (actor.area === "teacher" && classGroup.teacherId !== actor.teacherId) return { ok: false, message: "只能为自己负责的班级排课。" };
  if (classGroup.teacher.status !== "ACTIVE") return { ok: false, message: "这个班的教师已停用，不能排课。" };
  const roomResult = await resolveClassroom(actor, classroom);
  if (!roomResult.room) return { ok: false, message: roomResult.error ?? "请选择可用教室。" };
  const enrolled = await prisma.enrollment.findMany({
    where: { organizationId: actor.organizationId, classGroupId: classGroup.id, student: { status: "ACTIVE" } },
    select: { studentId: true, student: { select: { name: true, studentNo: true } } },
    distinct: ["studentId"],
  });
  const studentIds = enrolled.map((row) => row.studentId);
  const conflicts = findScheduleConflicts(
    { teacherId: classGroup.teacherId, classGroupId: classGroup.id, location: roomResult.room.name, classroomId: roomResult.room.id, studentIds, startAt, endAt },
    await lessonsInWindow(actor.organizationId, startAt, endAt, studentIds),
  );
  const seats = roomCapacityWarning(studentIds.length, roomResult.room.capacity, roomResult.room.name);
  const warning = [
    conflicts.length > 0 ? singleConflictWarning(conflicts, formatDateTime, "确认后仍会排这节课。") : "",
    seats,
  ].filter(Boolean).join("\n");
  return {
    ok: true,
    summary: `小星助教准备为【${classGroup.course.name} · ${classGroup.name}】排课：${formatDateTime(startAt)}–${formatClock(endAt)}，教室【${roomResult.room.name}】，名单 ${studentIds.length} 人，是否确认执行？`,
    detail: warning,
    args: {
      classGroupId: classGroup.id,
      teacherId: classGroup.teacherId,
      classroomId: roomResult.room.id,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
    },
  };
}

async function previewPublish(actor: Actor, args: Record<string, unknown>): Promise<Preview> {
  const reportId = typeof args.reportId === "string" ? args.reportId.trim() : "";
  if (!reportId) return { ok: false, message: "请提供报告 ID。" };
  const report = await prisma.teachingReport.findFirst({
    where: { id: reportId, organizationId: actor.organizationId },
    select: {
      id: true,
      status: true,
      student: { select: { id: true, name: true } },
      lessonSession: { select: { title: true, teacherId: true } },
    },
  });
  if (!report) return { ok: false, message: "没有找到这份报告。" };
  if (!(await studentAllowed(actor, report.student.id))) return { ok: false, message: "你不能发布这名学生的报告。" };
  if (actor.area === "teacher" && report.lessonSession.teacherId !== actor.teacherId) return { ok: false, message: "只能发布自己课次上的报告。" };
  if (actor.area === "owner") {
    const teacher = await prisma.teacher.findFirst({
      where: { userId: actor.id, organizationId: actor.organizationId, status: "ACTIVE" },
      select: { id: true },
    });
    if (teacher?.id !== report.lessonSession.teacherId) return { ok: false, message: "只有这节课的授课教师可以发布报告。" };
  }
  if (report.status !== "CONFIRMED") return { ok: false, message: "只能发布已经确认的报告。草稿需要老师先确认。" };
  return {
    ok: true,
    summary: `小星助教准备发布【${report.student.name}】的报告【${report.lessonSession.title ?? "课次"}】，是否确认执行？`,
    detail: "发布后家长可以查看。",
    args: { reportId: report.id, teacherId: report.lessonSession.teacherId },
  };
}

async function previewWrite(actor: Actor, name: string, args: Record<string, unknown>): Promise<Preview> {
  if (name === "adjust_student_hours") return previewAdjust(actor, args);
  if (name === "create_lesson") return previewLesson(actor, args);
  if (name === "publish_report") return previewPublish(actor, args);
  return { ok: false, message: "不能通过小星助教执行这个操作。" };
}

async function runTool(actor: Actor, name: string, args: Record<string, unknown>) {
  const gate = assertAssistantMayExecute(name, args);
  if (!gate.ok) return gate.message;
  if (name === "get_overdue_students") return overdueStudents(actor);
  if (name === "search_student") return searchStudent(actor, typeof args.name === "string" ? args.name : "");
  if (name === "get_student_recent_reports") return recentReports(actor, typeof args.studentId === "string" ? args.studentId : "");
  return "没有这个查询功能。";
}

function parseArgs(raw: string) {
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("bad-args");
  return value as Record<string, unknown>;
}

function modelClient() {
  const apiKey = process.env.AI_API_KEY?.trim();
  const base = process.env.AI_BASE_URL?.trim().replace(/\/+$/, "");
  const model = process.env.AI_MODEL?.trim();
  if (!apiKey || !base || !model) return null;
  return {
    model,
    client: new OpenAI({
      apiKey,
      baseURL: base.endsWith("/v1") ? base : `${base}/v1`,
      timeout: 15000,
      maxRetries: 0,
    }),
  };
}

function history(input: unknown): OpenAI.Chat.ChatCompletionMessageParam[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const role = "role" in item ? item.role : "";
    const content = "content" in item && typeof item.content === "string" ? item.content.trim() : "";
    if ((role !== "user" && role !== "assistant") || !content) return [];
    return [{ role, content: content.slice(0, 2000) }];
  }).slice(-12);
}

export async function runAssistant(actor: Actor, messages: unknown, modeInput: unknown = "agent"): Promise<AgentReply> {
  const mode = parseAssistantMode(modeInput);
  const ai = modelClient();
  if (!ai) return { ok: false, message: "小星助教还没有配置完成，请稍后再试。" };
  const conversation: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `${assistantSkill()}\n\n${modeContractPrompt(mode, actor.area)}`,
    },
    ...history(messages),
  ];
  if (conversation.length === 1) return { ok: false, message: "请先告诉我你想查询或办理什么。" };
  const latestUser = [...conversation].reverse().find((item) => item.role === "user");
  const latestText = latestUser && typeof latestUser.content === "string" ? latestUser.content : "";
  // 家长端不做全机构名单/经营筛查，避免误开负责人页。
  if (actor.area !== "parent") {
    const screened = screenIntent(latestText) ?? queueIntent(latestText);
    if (screened) {
      const located = await locateWork(asStaff(actor), screened);
      if (!located.ok) return { ok: true, type: "message", content: located.message };
      return { ok: true, type: "navigate", content: located.reply, navigation: { href: located.href } };
    }
  }
  const lookOnly = /^(打开|带我去|去看|我想看|查看|跳转)/.test(latestText.replace(/\s+/g, "")) && !/交\s*\d+|\d+\s*(元|节)|现金|微信|支付宝/.test(latestText);
  const staffWork = /交\s*\d+|\d+\s*(元|节)|现金|微信|支付宝|银行卡|报名|排课|点名|考勤|调课时|加课|收款|退费|跟进|停用|取消课|补课/;
  const parentWork = /请假|消假|取消请假|回复报告|回报告|标已读|全部已读|标成已读/;
  // 用法 FAQ 不强制办理；有明确写入槽的 helpIntent 会返回 false，仍走 workOrder。
  const usageHelp = helpIntent(latestText);
  const workOrder =
    !latestText.startsWith("系统已执行") &&
    !lookOnly &&
    !usageHelp &&
    (actor.area === "parent" ? parentWork.test(latestText) : staffWork.test(latestText));
  if (mode === "ask" && workOrder) {
    return {
      ok: true,
      type: "message",
      content:
        actor.area === "parent"
          ? "这件事需要写入系统。请把顶部切换到「工作模式」，再说一次，我会查齐信息并弹出确认卡让你核对后再执行。"
          : "这件事需要写入系统。请把顶部切换到「工作模式」，再说一次，我会查齐信息并弹出确认卡让你核对后再执行。",
    };
  }
  // 财务三禁：不进模型乱跳，直接打开收款入口并说明须人在页面操作（对齐 Cursor 对敏感写的硬拦截）。
  const financeAsk = !latestText.startsWith("系统已执行") && /收款|退费|作废流水|调课时|交\s*\d+|收\s*\d+\s*元|帮.+收/.test(latestText.replace(/\s+/g, ""));
  if (financeAsk) {
    if (actor.area === "parent") {
      return {
        ok: true,
        type: "navigate",
        content: "家长端可以查看孩子的课时与费用概况，但不能代交费或改账。已打开「课时与费用」页；交费请联系机构在线下或财务页处理。",
        navigation: { href: "/parent/courses" },
      };
    }
    const landed = await landForUtterance(asStaff(actor), latestText);
    const href = landed.href.includes("/billing") ? landed.href : actor.area === "owner" ? "/owner/billing?form=pay" : "/teacher";
    if (mode === "ask") {
      return {
        ok: true,
        type: "navigate",
        content: "收款、退费、作废和调课时属于财务操作，问答模式也不能代写。已打开「报名与课时」入口，请切换到工作台页面由人操作；若只要查欠费/收入，可以直接问「谁欠费」或「本月收了多少」。",
        navigation: { href },
      };
    }
    return {
      ok: true,
      type: "navigate",
      content: "收款、退费、作废和调课时是财务三禁，我不能代为写入。已打开对应页面，请你在页面完成这笔操作；我可以继续帮你查欠费、收入或打开某位学生的报名卡片。",
      navigation: { href },
    };
  }

  try {
    let toolChoice: OpenAI.Chat.ChatCompletionToolChoiceOption = mode === "agent" && workOrder ? "required" : "auto";
    for (let step = 0; step < 8; step += 1) {
      const completion = await ai.client.chat.completions.create({
        model: ai.model,
        temperature: 0.2,
        messages: conversation,
        tools: toolsFor(actor, mode),
        tool_choice: toolChoice,
      });
      toolChoice = "auto";
      const message = completion.choices[0]?.message;
      if (!message) return { ok: false, message: assistantTimeoutMessage };
      const calls = message.tool_calls ?? [];
      if (calls.length === 0) {
        const content = message.content?.trim() || "我没有查到可以回答的内容。";
        if (mode === "agent" && workOrder && step < 2) {
          conversation.push({ role: "assistant", content: content });
          conversation.push({
            role: "user",
            content: "（系统）上一轮没有调用工具。这是办理任务：请先用查询工具拿到编号，再调用对应的 execute_ 工具。不要只文字说明。",
          });
          toolChoice = "required";
          continue;
        }
        return answerAndOpen(actor, latestText, content, mode);
      }
      conversation.push(message);
      for (const call of calls) {
        if (call.type !== "function") {
          conversation.push({ role: "tool", tool_call_id: call.id, content: "不能通过小星助教执行这个操作。" });
          continue;
        }
        let args: Record<string, unknown>;
        try {
          args = parseArgs(call.function.arguments || "{}");
        } catch {
          return { ok: false, message: assistantTimeoutMessage };
        }
        if (mode === "ask" && isAskBlockedTool(call.function.name)) {
          conversation.push({ role: "tool", tool_call_id: call.id, content: askModeBlockedMessage(actor.area) });
          continue;
        }
        if (actor.area === "parent") {
          if (call.function.name === "screen_students") {
            conversation.push({ role: "tool", tool_call_id: call.id, content: "家长端不能查看全机构名单，只能查已绑定的孩子。" });
            continue;
          }
          if (call.function.name === "open_exact") {
            if (workOrder) {
              conversation.push({
                role: "tool",
                tool_call_id: call.id,
                content: "这是要办理的业务，不能只打开页面。请先用查询工具拿到编号，再调用对应的 execute_ 工具。",
              });
              continue;
            }
            const place = typeof args.place === "string" ? args.place : "";
            const target = typeof args.target === "string" ? args.target : "";
            const located = await resolveParentPlace(asParent(actor), place, target);
            if (!located.ok) {
              conversation.push({ role: "tool", tool_call_id: call.id, content: located.message });
              continue;
            }
            return { ok: true, type: "navigate", content: located.reply, navigation: { href: located.href } };
          }
          if (parentWriteTools.has(call.function.name)) {
            if (mode === "ask") {
              conversation.push({ role: "tool", tool_call_id: call.id, content: askModeBlockedMessage("parent") });
              continue;
            }
            const preview = await previewParentWrite(asParent(actor), call.function.name, args);
            if (!preview.ok) {
              conversation.push({
                role: "tool",
                tool_call_id: call.id,
                content: `${preview.message} 缺什么就只补问那一项；能查到的编号请先用查询工具拿到再调用。`,
              });
              continue;
            }
            let token = "";
            try {
              token = sign({
                exp: Date.now() + 10 * 60 * 1000,
                userId: actor.id,
                organizationId: actor.organizationId,
                area: actor.area,
                teacherId: actor.teacherId,
                tool: call.function.name,
                args: preview.args,
              });
            } catch {
              return { ok: false, message: "小星助教暂时不能发起修改，请稍后再试。" };
            }
            return {
              ok: true,
              type: "confirm",
              content: "好的，准备为您执行这项操作。请核对下面的参数，确认后才会写入。",
              confirmation: {
                token,
                summary: preview.summary.replace(/，?是否确认[执行？]*？/g, "").replace(/，?是否确认？/g, ""),
                detail: preview.detail,
                href: preview.href || pageFor(actor.area, call.function.name),
                fields: confirmFields(preview.summary, preview.detail),
              },
            };
          }
          const content = await runParentTool(asParent(actor), call.function.name, args);
          conversation.push({ role: "tool", tool_call_id: call.id, content });
          continue;
        }
        const staff = asStaff(actor);
        if (call.function.name === "screen_students") {
          const situation = typeof args.situation === "string" ? args.situation : "";
          const located = await locateWork(staff, situation);
          if (!located.ok) {
            conversation.push({ role: "tool", tool_call_id: call.id, content: located.message });
            continue;
          }
          return { ok: true, type: "navigate", content: located.reply, navigation: { href: located.href } };
        }
        if (call.function.name === "open_exact") {
          if (workOrder) {
            conversation.push({ role: "tool", tool_call_id: call.id, content: "这是要办理的业务，不能只打开页面。请先用查询工具拿到编号，再调用对应的 execute_ 工具。缺的只有一项时，向用户补问那一项。" });
            continue;
          }
          const place = typeof args.place === "string" ? args.place : "";
          const target = typeof args.target === "string" ? args.target : "";
          const located = await resolveExactPlace(staff, place, target);
          if (!located.ok) {
            conversation.push({ role: "tool", tool_call_id: call.id, content: located.message });
            continue;
          }
          return { ok: true, type: "navigate", content: located.reply, navigation: { href: located.href } };
        }
        const routed = routeExecute(call.function.name, args);
        if (routed && "error" in routed) {
          conversation.push({ role: "tool", tool_call_id: call.id, content: routed.error });
          continue;
        }
        if (routed && "tool" in routed) {
          if (mode === "ask") {
            conversation.push({ role: "tool", tool_call_id: call.id, content: askModeBlockedMessage(actor.area) });
            continue;
          }
          const toolName = routed.tool;
          const preview = toolName === "adjust_student_hours" || toolName === "create_lesson" || toolName === "publish_report"
            ? await previewWrite(staff, toolName, routed.args)
            : await previewOperation(staff, toolName, routed.args);
          if (!preview.ok) {
            conversation.push({ role: "tool", tool_call_id: call.id, content: `${preview.message} 缺什么就只向用户补问那一项。能查到的编号请先用查询工具拿到，再重新调用这个执行工具。不要让用户自己去页面填表。` });
            if (preview.message.includes("学生")) toolChoice = { type: "function", function: { name: "search_student" } };
            continue;
          }
          let token = "";
          try {
            token = sign({
              exp: Date.now() + 10 * 60 * 1000,
              userId: actor.id,
              organizationId: actor.organizationId,
              area: actor.area,
              teacherId: actor.teacherId,
              tool: toolName,
              args: preview.args,
            });
          } catch {
            return { ok: false, message: "小星助教暂时不能发起修改，请稍后再试。" };
          }
          const landed = await landForUtterance(staff, latestText);
          return {
            ok: true,
            type: "confirm",
            content: "好的，准备为您执行这项操作。请核对下面的参数，确认后才会写入。",
            confirmation: { token, summary: preview.summary.replace(/，?是否确认执行？/g, ""), detail: preview.detail, href: landed.href || pageFor(actor.area, toolName), fields: confirmFields(preview.summary, preview.detail) },
          };
        }
        if (writeTools.has(call.function.name)) {
          conversation.push({ role: "tool", tool_call_id: call.id, content: "请改用 execute_ 开头的执行工具。" });
          continue;
        }
        const operated = await runOperationRead(staff, call.function.name, args);
        const content = operated ?? await runTool(staff, call.function.name, args);
        conversation.push({ role: "tool", tool_call_id: call.id, content });
      }
    }
    return answerAndOpen(actor, latestText, "这次需要的步骤太多，请把想办的事再说得具体一些。", mode);
  } catch (error) {
    if (error instanceof OpenAI.APIConnectionTimeoutError || (error instanceof Error && /timeout|timed out/i.test(error.message))) {
      return { ok: false, message: assistantTimeoutMessage };
    }
    return { ok: false, message: assistantTimeoutMessage };
  }
}

export async function executeAssistant(actor: Actor, token: string) {
  let payload: ConfirmPayload | null;
  try {
    payload = readToken(token);
  } catch {
    return { ok: false as const, message: "这次确认无效，没有写入。" };
  }
  if (!payload || payload.userId !== actor.id || payload.organizationId !== actor.organizationId || payload.area !== actor.area || payload.teacherId !== actor.teacherId) {
    return { ok: false as const, message: "这次确认已过期或无效，没有写入。" };
  }
  const gate = assertAssistantMayExecute(payload.tool, payload.args);
  if (!gate.ok) return { ok: false as const, message: gate.message };
  if (actor.area === "parent") {
    if (!parentWriteTools.has(payload.tool)) {
      return { ok: false as const, message: "家长端小星不能执行这个操作。" };
    }
    const again = await previewParentWrite(asParent(actor), payload.tool, payload.args);
    if (!again.ok) return { ok: false as const, message: again.message };
    const result = await executeParentWrite(asParent(actor), payload.tool, again.args);
    if (result.ok) refreshAssistant();
    return result;
  }
  const staff = asStaff(actor);
  if (operationWrites.has(payload.tool)) {
    const again = await previewOperation(staff, payload.tool, payload.args);
    if (!again.ok) return { ok: false as const, message: again.message };
    return executeOperation(staff, payload.tool, again.args);
  }
  if (payload.tool === "adjust_student_hours") {
    return { ok: false as const, message: assistantForbiddenMessage("finance") };
  }
  if (payload.tool === "publish_report") {
    const again = await previewWrite(actor, payload.tool, payload.args);
    if (!again.ok) return { ok: false as const, message: again.message };
  }
  try {
    if (payload.tool === "adjust_student_hours") {
      return { ok: false as const, message: assistantForbiddenMessage("finance") };
    }
    if (payload.tool === "create_lesson") {
      const classGroup = await prisma.classGroup.findFirst({
        where: { id: String(payload.args.classGroupId), organizationId: actor.organizationId, status: "ACTIVE" },
        select: { id: true, courseId: true, name: true, teacherId: true, course: { select: { name: true } } },
      });
      const room = await prisma.classroom.findFirst({
        where: { id: String(payload.args.classroomId), organizationId: actor.organizationId, available: true },
        select: { id: true, name: true },
      });
      if (!classGroup || !room) return { ok: false as const, message: "班级或教室已经变化，没有排课。" };
      if (actor.area === "teacher" && classGroup.teacherId !== actor.teacherId) return { ok: false as const, message: "只能为自己负责的班级排课。" };
      if (String(payload.args.teacherId) !== classGroup.teacherId) return { ok: false as const, message: "班级教师已经变化，没有排课。" };
      const startAt = new Date(String(payload.args.startAt));
      const endAt = new Date(String(payload.args.endAt));
      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) return { ok: false as const, message: "上课时间无效，没有排课。" };
      const enrolled = await prisma.enrollment.findMany({
        where: { organizationId: actor.organizationId, classGroupId: classGroup.id, student: { status: "ACTIVE" } },
        select: { studentId: true },
        distinct: ["studentId"],
      });
      await prisma.lessonSession.create({
        data: {
          organizationId: actor.organizationId,
          classGroupId: classGroup.id,
          courseId: classGroup.courseId,
          teacherId: classGroup.teacherId,
          title: `${classGroup.course.name} · ${classGroup.name}`,
          startAt,
          endAt,
          location: room.name,
          classroomId: room.id,
          createdById: actor.id,
          students: {
            create: enrolled.map((row) => ({
              organizationId: actor.organizationId,
              studentId: row.studentId,
              seat: "ENROLLED",
              lastAction: "加入课次",
            })),
          },
        },
      });
      refreshAssistant();
      return { ok: true as const, message: `已排课：${classGroup.course.name} · ${classGroup.name}，${formatDateTime(startAt)}，教室 ${room.name}。` };
    }
    const reportId = String(payload.args.reportId);
    const teacherId = String(payload.args.teacherId);
    const actingTeacher = actor.area === "teacher"
      ? actor.teacherId
      : (await prisma.teacher.findFirst({
          where: { userId: actor.id, organizationId: actor.organizationId, status: "ACTIVE" },
          select: { id: true },
        }))?.id ?? null;
    if (!actingTeacher || actingTeacher !== teacherId) return { ok: false as const, message: "只有这节课的授课教师可以发布报告。" };
    const result = await publishReportByTeacher(prisma, { id: actor.id, organizationId: actor.organizationId, teacherId: actingTeacher }, reportId);
    if (!result.ok) return result;
    if (!("published" in result)) return { ok: true as const, message: result.message ?? "报告已确认，家长还看不到。请再发布一次。" };
    refreshAssistant();
    return { ok: true as const, message: "报告已发布，家长现在可以查看。" };
  } catch (error) {
    if (error instanceof CourseHourError) return { ok: false as const, message: error.message };
    return { ok: false as const, message: "没有写入成功，请稍后再试。" };
  }
}
