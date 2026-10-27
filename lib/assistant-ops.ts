import { revalidatePath } from "next/cache";
import type OpenAI from "openai";
import { recordRenewalFollowUp, scheduleMakeup } from "@/app/owner/attendance/actions";
import { createEnrollment } from "@/app/owner/billing/actions";
import { archiveClassGroup, archiveCourse, createClassGroup, createCourse, restoreClassGroup, restoreCourse, updateClassGroup } from "@/app/owner/courses/actions";
import { admitWaitlist, joinClassWaitlist } from "@/app/owner/courses/waitlist-actions";
import { issueParentInvite, issueTeacherInvite } from "@/app/owner/membership/actions";
import { returnReport } from "@/app/owner/reports/actions";
import { createClassroom, updateClassroom } from "@/app/owner/rooms/actions";
import { cancelLesson, changeLessonClassroom, createRecurringLessons, updateLessonTeacher } from "@/app/owner/schedule/actions";
import { saveOrganizationSettings } from "@/app/owner/settings/actions";
import { createStudent, deactivateStudent, setStudentStatus, updateStudent } from "@/app/owner/students/actions";
import { createTeacher, setTeacherStatus } from "@/app/owner/teachers/actions";
import { addTeacherLessonStudent } from "@/app/teacher/actions";
import { writeAudit } from "@/lib/audit";
import { recordPayment } from "@/lib/billing-ledger";
import { syncAttendanceCharge, CourseHourError } from "@/lib/course-hours";
import { ownerOverview, ownerSnapshot } from "@/lib/dashboard";
import { formatClock, formatDateTime, parseShanghaiDateTime, shanghaiDateKey } from "@/lib/datetime";
import { isPaymentMethod, paymentMethodLabel } from "@/lib/enrollment-money";
import { findScheduleConflicts, roomCapacityWarning, singleConflictWarning, type ExistingLesson } from "@/lib/lesson-conflicts";
import { attendanceDisplayLabel, toAttendanceFields } from "@/lib/leave-kind";
import { attendanceLabel } from "@/lib/lesson-labels";
import { ownerTodoLists } from "@/lib/todo-center";
import { generateLessonAnalysis, AiReportError } from "@/lib/ai-service";
import { generateAndStoreDraft, readOrgReportSettings, recentSummariesForPrompt } from "@/lib/report-flow";
import { cancelPendingLessonRequests, submitLessonRequest } from "@/lib/lesson-requests";
import { notifyHomeworkSaved, notifyLessonChange, notifyMakeupArranged } from "@/lib/parent-notice";
import { prisma } from "@/lib/prisma";
import { recurringDates } from "@/lib/recurring-schedule";

type Area = "owner" | "teacher";

type Actor = {
  id: string;
  name: string;
  organizationId: string;
  area: Area;
  teacherId: string | null;
};

type Preview =
  | { ok: false; message: string }
  | { ok: true; summary: string; detail: string; args: Record<string, string | number> };

const denied = "当前账号不能办理这项业务。";

export const ownerPages = [
  { href: "/owner", label: "工作台" },
  { href: "/owner/todos", label: "待办中心" },
  { href: "/owner/students", label: "学生管理" },
  { href: "/owner/teachers", label: "教师管理" },
  { href: "/owner/courses", label: "课程与班级" },
  { href: "/owner/rooms", label: "教室管理" },
  { href: "/owner/schedule", label: "排课 / 课表" },
  { href: "/owner/reports", label: "教学报告" },
  { href: "/owner/billing", label: "报名与课时" },
  { href: "/owner/audit", label: "操作记录" },
  { href: "/owner/stats", label: "基础统计" },
  { href: "/owner/settings", label: "机构设置" },
] as const;

const teacherPages = [
  { href: "/teacher", label: "总览" },
  { href: "/teacher/schedule", label: "我的课表" },
  { href: "/teacher/students", label: "我的学生" },
  { href: "/teacher/records", label: "教学记录" },
  { href: "/teacher/reports", label: "教学报告" },
] as const;

const ownerOnly = new Set([
  "create_student",
  "bind_parent",
  "create_teacher",
  "assign_course_to_teacher",
  "create_course",
  "create_class_group",
  "create_classroom",
  "edit_classroom_status",
  "create_enrollment",
  "record_payment",
  "add_waitlist",
  "add_follow_up",
  "update_student",
  "set_student_status",
  "stop_enrollment",
  "set_teacher_status",
  "issue_teacher_invite",
  "update_class_group",
  "set_course_status",
  "set_class_status",
  "change_lesson_classroom",
  "change_lesson_teacher",
  "cancel_lesson",
  "return_report",
  "admit_waitlist",
  "update_organization",
  "get_overdue_students",
  "get_audit_logs",
  "get_stats_summary",
  "get_revenue_summary",
  "lookup_teacher",
]);

export const operationWrites = new Set([
  "create_student",
  "bind_parent",
  "create_teacher",
  "assign_course_to_teacher",
  "create_course",
  "create_class_group",
  "create_classroom",
  "edit_classroom_status",
  "schedule_recurring_lessons",
  "mark_attendance",
  "change_lesson_time",
  "make_up_lesson",
  "generate_ai_report",
  "create_enrollment",
  "record_payment",
  "add_waitlist",
  "add_follow_up",
  "update_student",
  "set_student_status",
  "stop_enrollment",
  "set_teacher_status",
  "issue_teacher_invite",
  "update_class_group",
  "set_course_status",
  "set_class_status",
  "change_lesson_classroom",
  "change_lesson_teacher",
  "cancel_lesson",
  "return_report",
  "admit_waitlist",
  "update_organization",
  "add_lesson_student",
]);

function str(args: Record<string, unknown>, key: string) {
  const value = args[key];
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function blocked(actor: Actor, name: string) {
  return actor.area === "teacher" && ownerOnly.has(name);
}

export function resolveNavigate(area: Area, raw: string) {
  const path = raw.trim().replace(/\/+$/, "") || "/";
  const aliased = path === "/owner/classrooms" ? "/owner/rooms" : path;
  const pages = area === "owner" ? ownerPages : teacherPages;
  const match = pages.find((page) => page.href === aliased);
  if (!match) return { ok: false as const, message: area === "teacher" ? "教师端不能打开财务、教师管理、机构设置、统计或操作记录。可以打开总览、课表、我的学生、教学记录或教学报告。" : "只能打开左侧菜单里的页面。" };
  return { ok: true as const, href: match.href, label: match.label };
}

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

const textProp = (description: string) => ({ type: "string", description });

const readToolNames = new Set(["lookup_class", "lookup_course", "lookup_lesson", "lookup_teacher", "get_today_overview", "get_pending_todos", "get_teacher_schedule", "get_audit_logs", "get_stats_summary", "get_revenue_summary"]);

export function lookupTools(actor: Actor) {
  return operationTools(actor).filter((item) => item.type === "function" && readToolNames.has(item.function.name));
}

export function executeTools(actor: Actor): OpenAI.Chat.ChatCompletionTool[] {
  const owner = actor.area === "owner";
  const shared: OpenAI.Chat.ChatCompletionTool[] = [
    tool("execute_adjust_hours", "直接发起课时调整。信息够就立刻调用，系统会弹出带参数的确认框，用户点确认后才写入。", {
      studentId: textProp("学生 ID，必须来自 search_student"),
      courseId: textProp("课程 ID，必须来自查询结果"),
      deltaHours: { type: "integer", description: "正数增加，负数减少，不能为 0" },
      reason: textProp("原因，1 到 80 个字"),
    }, ["studentId", "courseId", "deltaHours", "reason"]),
    tool("execute_schedule_lesson", "直接发起单次或周期排课。信息够就立刻调用。mode 用 single 或 recurring。", {
      mode: { type: "string", enum: ["single", "recurring"] },
      classGroupId: textProp("班级 ID"),
      classroom: textProp("教室 ID 或名称"),
      startAt: textProp("单次：上海时间 2026-10-30T16:00"),
      endAt: textProp("单次：上海时间 2026-10-30T17:30"),
      startDate: textProp("周期：YYYY-MM-DD"),
      endDate: textProp("周期：YYYY-MM-DD"),
      startTime: textProp("周期：HH:mm"),
      endTime: textProp("周期：HH:mm"),
      weekdays: textProp("周期：1,3,5，0 是周日"),
    }, ["mode", "classGroupId", "classroom"]),
    tool("execute_mark_attendance", "直接发起点名。信息够就立刻调用。", {
      lessonId: textProp("课次 ID"),
      studentId: textProp("学生 ID"),
      status: { type: "string", enum: ["PRESENT", "LATE", "ABSENT", "LEAVE", "PERSONAL", "SICK"] },
      note: textProp("可选备注"),
    }, ["lessonId", "studentId", "status"]),
    tool("execute_generate_report", "直接发起生成草稿、发布或退回报告。action 用 generate、publish 或 return。", {
      action: { type: "string", enum: ["generate", "publish", "return"] },
      lessonId: textProp("生成草稿时的课次 ID"),
      reportId: textProp("发布或退回时的报告 ID"),
      lessonContent: textProp("没有教学记录时必填"),
      reason: textProp("退回原因"),
    }, ["action"]),
    tool("execute_lesson", "直接发起调课、换教室、换教师、取消课次、安排补课或把学生加入课次。action 用 reschedule、room、teacher、cancel、makeup、add。取消只改状态，不是删除。", {
      action: { type: "string", enum: ["reschedule", "room", "teacher", "cancel", "makeup", "add"] },
      lessonId: textProp("课次 ID"),
      startAt: textProp("调课开始时间"),
      endAt: textProp("调课结束时间"),
      classroom: textProp("教室"),
      teacherId: textProp("教师 ID"),
      studentId: textProp("学生 ID"),
      seat: { type: "string", enum: ["ENROLLED", "TRIAL", "GUEST"] },
      sourceLessonStudentId: textProp("请假名单 ID"),
      targetLessonId: textProp("补课目标课次 ID"),
    }, ["action"]),
  ];
  if (!owner) return shared;
  return [
    ...shared,
    tool("execute_enrollment", "直接发起报名和收款。学生、课程、班级、应收、实收都有了就立刻调用，不要让用户自己去填表。", {
      studentId: textProp("学生 ID"),
      courseId: textProp("课程 ID"),
      classGroupId: textProp("班级 ID"),
      amountDue: textProp("应收，元"),
      amountPaid: textProp("实收，元"),
      hours: { type: "integer", description: "按课时课程的购买节数" },
      payMethod: { type: "string", enum: ["CASH", "WECHAT", "ALIPAY", "BANK", "OTHER"] },
      discountPercent: textProp("可选，例如 80%"),
      startDate: textProp("按周期课程 YYYY-MM-DD"),
      endDate: textProp("按周期课程 YYYY-MM-DD"),
    }, ["studentId", "courseId", "classGroupId", "amountDue", "amountPaid"]),
    tool("execute_payment", "直接发起收款或退费。kind 用 collect 或 refund。", {
      studentId: textProp("学生 ID"),
      courseId: textProp("课程 ID"),
      amount: textProp("金额，元"),
      method: { type: "string", enum: ["CASH", "WECHAT", "ALIPAY", "BANK", "OTHER"] },
      kind: { type: "string", enum: ["collect", "refund"] },
      reason: textProp("退费必填"),
    }, ["studentId", "courseId", "amount", "method", "kind"]),
    tool("execute_student_crud", "直接发起新建、修改学生，停用或恢复档案，停用某门报名，或生成家长邀请码。action 用 create、update、status、stop、bind。", {
      action: { type: "string", enum: ["create", "update", "status", "stop", "bind"] },
      studentId: textProp("除新建外必填"),
      name: textProp("姓名"),
      grade: textProp("年级"),
      guardianName: textProp("家长姓名"),
      guardianPhone: textProp("家长手机"),
      status: { type: "string", enum: ["ACTIVE", "INACTIVE"] },
      courseId: textProp("停用报名时的课程 ID"),
      reason: textProp("停用报名的原因"),
    }, ["action"]),
    tool("execute_teacher_crud", "直接发起新建教师、停用或恢复、分配课程、生成教师邀请码。action 用 create、status、assign、invite。", {
      action: { type: "string", enum: ["create", "status", "assign", "invite"] },
      teacherId: textProp("教师 ID"),
      name: textProp("姓名"),
      phone: textProp("手机"),
      courseId: textProp("课程 ID"),
      status: { type: "string", enum: ["ACTIVE", "INACTIVE"] },
    }, ["action"]),
    tool("execute_course", "直接发起课程或班级的新建、修改、归档、恢复。action 用 create_course、create_class、update_class、archive_course、restore_course、archive_class、restore_class。归档不是删除。", {
      action: { type: "string", enum: ["create_course", "create_class", "update_class", "archive_course", "restore_course", "archive_class", "restore_class"] },
      name: textProp("名称"),
      billingType: { type: "string", enum: ["PER_LESSON", "PER_PERIOD"] },
      courseId: textProp("课程 ID"),
      classGroupId: textProp("班级 ID"),
      teacherId: textProp("教师 ID"),
      capacity: { type: "integer" },
      description: textProp("课程描述"),
    }, ["action"]),
    tool("execute_classroom", "直接发起新增教室或启用、停用教室。action 用 create 或 status。", {
      action: { type: "string", enum: ["create", "status"] },
      name: textProp("教室名称"),
      capacity: { type: "integer" },
      classroom: textProp("教室 ID 或名称"),
      available: { type: "boolean" },
    }, ["action"]),
    tool("execute_followup", "直接发起续费跟进。", {
      studentId: textProp("学生 ID"),
      courseId: textProp("课程 ID"),
      outcome: { type: "string", enum: ["TO_CONTACT", "CONTACTED", "NEXT_BOOKED", "DECLINED"] },
      note: textProp("备注"),
      nextContactOn: textProp("YYYY-MM-DD"),
    }, ["studentId", "courseId", "outcome"]),
    tool("execute_waitlist", "直接发起加入排队或把排队转入班级。action 用 join 或 admit。", {
      action: { type: "string", enum: ["join", "admit"] },
      studentId: textProp("学生 ID"),
      classGroupId: textProp("班级 ID"),
      waitlistId: textProp("排队记录 ID"),
    }, ["action"]),
    tool("execute_organization", "直接发起修改机构名称。不要改语言。", { name: textProp("2 到 40 个字") }, ["name"]),
  ];
}

export function routeExecute(name: string, args: Record<string, unknown>): { error: string } | { tool: string; args: Record<string, unknown> } | null {
  const action = typeof args.action === "string" ? args.action : "";
  const mode = typeof args.mode === "string" ? args.mode : "";
  if (name === "navigate_to" || /delete|remove|drop|销毁/i.test(name) || name.includes("删除")) {
    return { error: "不能只跳转页面，也不能删除。请调用对应的 execute_ 工具完成业务。" };
  }
  if (name === "execute_adjust_hours") return { tool: "adjust_student_hours", args };
  if (name === "execute_schedule_lesson") return { tool: mode === "recurring" ? "schedule_recurring_lessons" : "create_lesson", args };
  if (name === "execute_mark_attendance") return { tool: "mark_attendance", args };
  if (name === "execute_generate_report") {
    if (action === "publish") return { tool: "publish_report", args };
    if (action === "return") return { tool: "return_report", args };
    return { tool: "generate_ai_report", args };
  }
  if (name === "execute_lesson") {
    const map: Record<string, string> = { reschedule: "change_lesson_time", room: "change_lesson_classroom", teacher: "change_lesson_teacher", cancel: "cancel_lesson", makeup: "make_up_lesson", add: "add_lesson_student" };
    const toolName = map[action];
    return toolName ? { tool: toolName, args } : { error: "请说明是调课、换教室、换教师、取消、补课还是加入名单。" };
  }
  if (name === "execute_enrollment") return { tool: "create_enrollment", args };
  if (name === "execute_payment") return { tool: "record_payment", args };
  if (name === "execute_student_crud") {
    const map: Record<string, string> = { create: "create_student", update: "update_student", status: "set_student_status", stop: "stop_enrollment", bind: "bind_parent" };
    const toolName = map[action];
    return toolName ? { tool: toolName, args } : { error: "请说明是新建、修改、停用、恢复、停报名还是绑定家长。" };
  }
  if (name === "execute_teacher_crud") {
    const map: Record<string, string> = { create: "create_teacher", status: "set_teacher_status", assign: "assign_course_to_teacher", invite: "issue_teacher_invite" };
    const toolName = map[action];
    return toolName ? { tool: toolName, args } : { error: "请说明是新建教师、停用、分配课程还是生成邀请码。" };
  }
  if (name === "execute_course") {
    const map: Record<string, string> = { create_course: "create_course", create_class: "create_class_group", update_class: "update_class_group", archive_course: "set_course_status", restore_course: "set_course_status", archive_class: "set_class_status", restore_class: "set_class_status" };
    const toolName = map[action];
    if (!toolName) return { error: "请说明要对课程或班级做什么。" };
    const status = action.startsWith("archive") ? "ARCHIVED" : action.startsWith("restore") ? "ACTIVE" : args.status;
    return { tool: toolName, args: { ...args, status } };
  }
  if (name === "execute_classroom") return { tool: action === "status" ? "edit_classroom_status" : "create_classroom", args };
  if (name === "execute_followup") return { tool: "add_follow_up", args };
  if (name === "execute_waitlist") return { tool: action === "admit" ? "admit_waitlist" : "add_waitlist", args };
  if (name === "execute_organization") return { tool: "update_organization", args };
  return null;
}

export function operationTools(actor: Actor): OpenAI.Chat.ChatCompletionTool[] {
  const shared: OpenAI.Chat.ChatCompletionTool[] = [
    tool("lookup_class", "按班级名称查找班级 ID、课程和教师。写操作前用来取得班级 ID。", { name: textProp("班级名称") }, ["name"]),
    tool("lookup_course", "按课程名称查找课程 ID 和计费方式。", { name: textProp("课程名称") }, ["name"]),
    tool("lookup_lesson", "查找课次 ID。可按日期、标题或学生姓名。教师只能看到自己的课。", {
      date: textProp("可选，YYYY-MM-DD"),
      title: textProp("可选，课次或课程标题"),
      studentName: textProp("可选，学生姓名"),
    }, []),
    tool("get_today_overview", "查询今日概况：在读学生、今日课次。教师只看到自己的课。", {}, []),
    tool("get_pending_todos", "查询待办。教师只看到自己的教学记录和报告。", {}, []),
    tool("get_teacher_schedule", "查询教师接下来的课表。教师只能查自己。", { teacherName: textProp("教师姓名。教师端可留空") }, []),
    tool("schedule_recurring_lessons", "准备按星期重复排课。不会立刻写入。教师只能排自己负责的班。", {
      classGroupId: textProp("班级 ID"),
      startDate: textProp("YYYY-MM-DD"),
      endDate: textProp("YYYY-MM-DD"),
      startTime: textProp("HH:mm"),
      endTime: textProp("HH:mm"),
      classroom: textProp("教室 ID 或名称"),
      weekdays: textProp("星期，0 是周日，1 到 6 是周一到周六，用逗号分隔，例如 1,3,5"),
      skipWeekends: { type: "boolean", description: "选了周末时是否跳过" },
    }, ["classGroupId", "startDate", "endDate", "startTime", "endTime", "classroom", "weekdays"]),
    tool("mark_attendance", "准备为一名学生点名。不会立刻写入。状态用 PRESENT、LATE、ABSENT、LEAVE、PERSONAL（事假）、SICK（病假）。", {
      lessonId: textProp("课次 ID"),
      studentId: textProp("学生 ID"),
      status: { type: "string", enum: ["PRESENT", "LATE", "ABSENT", "LEAVE", "PERSONAL", "SICK"] },
      note: textProp("可选备注，最多 80 字"),
    }, ["lessonId", "studentId", "status"]),
    tool("change_lesson_time", "准备修改一节课的上课时间。不会立刻写入。", {
      lessonId: textProp("课次 ID"),
      startAt: textProp("上海时间 2026-10-30T16:00"),
      endAt: textProp("上海时间 2026-10-30T17:30"),
    }, ["lessonId", "startAt", "endAt"]),
    tool("make_up_lesson", "准备把一次请假补到另一节已有课。不会立刻写入。需要请假名单 ID 和目标课次 ID。", {
      sourceLessonStudentId: textProp("请假那一条名单 ID，来自 lookup_lesson"),
      targetLessonId: textProp("要补进去的课次 ID"),
    }, ["sourceLessonStudentId", "targetLessonId"]),
    tool("add_lesson_student", "把一名学生加入已有课次。系统会立即写入。教师只能加到自己还没开始的课。", {
      lessonId: textProp("课次 ID"),
      studentId: textProp("学生 ID"),
      seat: { type: "string", enum: ["ENROLLED", "TRIAL", "GUEST"], description: "本班用 ENROLLED，试听 TRIAL，临时 GUEST" },
    }, ["lessonId", "studentId", "seat"]),
    tool("generate_ai_report", "根据教学记录直接生成报告草稿。没有记录时必须同时给出教学内容。系统会立即写入。", {
      lessonId: textProp("课次 ID"),
      lessonContent: textProp("可选。没有教学记录时必填"),
      studentPerformance: textProp("可选。学生表现"),
      difficulties: textProp("可选。问题和难点"),
      homework: textProp("可选。作业"),
    }, ["lessonId"]),
  ];
  if (actor.area === "teacher") return shared;
  return [
    ...shared,
    tool("lookup_teacher", "按教师姓名查找教师 ID。仅负责人可用。", { name: textProp("教师姓名") }, ["name"]),
    tool("get_audit_logs", "查询本机构最近的操作记录。仅负责人可用。", {}, []),
    tool("get_stats_summary", "查询基础统计：在读学生、教师、课次、待填写记录和待确认报告。仅负责人可用。", {}, []),
    tool("get_revenue_summary", "查询本机构实收金额。按 Asia/Shanghai 自然月统计，只计未作废流水。问赚了多少、本月收入、收款合计时必须调用。禁止自己编数字。", {}, []),
    tool("create_student", "准备新建学生。不会立刻写入。", {
      name: textProp("学生姓名"),
      grade: textProp("可选年级"),
      guardianName: textProp("可选家长姓名"),
      guardianPhone: textProp("可选家长手机"),
    }, ["name"]),
    tool("bind_parent", "准备为一名学生生成家长绑定邀请码。不会立刻写入。", { studentId: textProp("学生 ID") }, ["studentId"]),
    tool("create_teacher", "准备新建教师，并可同时分配一门课。不会立刻写入。", {
      name: textProp("教师姓名"),
      phone: textProp("可选手机"),
      courseId: textProp("可选课程 ID"),
    }, ["name"]),
    tool("assign_course_to_teacher", "准备给教师追加一门授课课程，不移除已有课程。不会立刻写入。", {
      teacherId: textProp("教师 ID"),
      courseId: textProp("课程 ID"),
    }, ["teacherId", "courseId"]),
    tool("create_course", "准备创建课程。不会立刻写入。计费用 PER_LESSON 或 PER_PERIOD。", {
      name: textProp("课程名称"),
      billingType: { type: "string", enum: ["PER_LESSON", "PER_PERIOD"] },
      description: textProp("可选描述"),
    }, ["name", "billingType"]),
    tool("create_class_group", "准备在一门课下新建班级。不会立刻写入。", {
      name: textProp("班级名称"),
      courseId: textProp("课程 ID"),
      teacherId: textProp("主讲教师 ID"),
      capacity: { type: "integer", description: "可选容量，1 到 500" },
    }, ["name", "courseId", "teacherId"]),
    tool("create_classroom", "准备新增教室。不会立刻写入。", {
      name: textProp("教室名称"),
      capacity: { type: "integer", description: "容量，1 到 500" },
    }, ["name", "capacity"]),
    tool("edit_classroom_status", "准备启用或停用教室。不会立刻写入。", {
      classroom: textProp("教室 ID 或名称"),
      available: { type: "boolean", description: "true 启用，false 停用" },
    }, ["classroom", "available"]),
    tool("create_enrollment", "准备为已有学生办理一门课的报名。不会立刻写入。金额单位是元。", {
      studentId: textProp("学生 ID"),
      courseId: textProp("课程 ID"),
      classGroupId: textProp("班级 ID"),
      amountDue: textProp("应收，例如 4200"),
      amountPaid: textProp("实收，例如 3000"),
      hours: { type: "integer", description: "按课时课程的购买节数" },
      payMethod: { type: "string", enum: ["CASH", "WECHAT", "ALIPAY", "BANK", "OTHER"] },
      discountPercent: textProp("可选，例如 80%"),
      startDate: textProp("按周期课程的开始日期 YYYY-MM-DD"),
      endDate: textProp("按周期课程的结束日期 YYYY-MM-DD"),
    }, ["studentId", "courseId", "classGroupId", "amountDue", "amountPaid"]),
    tool("record_payment", "准备记一笔收款或退费。不会立刻写入。kind 用 collect 或 refund。", {
      studentId: textProp("学生 ID"),
      courseId: textProp("课程 ID"),
      amount: textProp("金额，元"),
      method: { type: "string", enum: ["CASH", "WECHAT", "ALIPAY", "BANK", "OTHER"] },
      kind: { type: "string", enum: ["collect", "refund"] },
      reason: textProp("退费必填，收款可选"),
    }, ["studentId", "courseId", "amount", "method", "kind"]),
    tool("add_waitlist", "准备把学生加入班级排队。不会立刻写入。", {
      studentId: textProp("学生 ID"),
      classGroupId: textProp("班级 ID"),
    }, ["studentId", "classGroupId"]),
    tool("add_follow_up", "直接记录续费跟进。结果用 CONTACTED、NEXT_BOOKED、DECLINED 或 TO_CONTACT。", {
      studentId: textProp("学生 ID"),
      courseId: textProp("课程 ID"),
      outcome: { type: "string", enum: ["TO_CONTACT", "CONTACTED", "NEXT_BOOKED", "DECLINED"] },
      note: textProp("可选备注"),
      nextContactOn: textProp("可选，YYYY-MM-DD"),
    }, ["studentId", "courseId", "outcome"]),
    tool("update_student", "直接修改学生档案。未提供的字段保持原值。", {
      studentId: textProp("学生 ID"),
      name: textProp("可选，新姓名"),
      grade: textProp("可选年级"),
      guardianName: textProp("可选家长姓名"),
      guardianPhone: textProp("可选家长手机"),
    }, ["studentId"]),
    tool("set_student_status", "直接停用或恢复学生档案。这不是删除，历史课次和报告会保留。", {
      studentId: textProp("学生 ID"),
      status: { type: "string", enum: ["ACTIVE", "INACTIVE"] },
    }, ["studentId", "status"]),
    tool("stop_enrollment", "直接停用某一门报名。需要原因。这不是删除历史记录。", {
      studentId: textProp("学生 ID"),
      courseId: textProp("课程 ID"),
      reason: textProp("1 到 80 个字的原因"),
    }, ["studentId", "courseId", "reason"]),
    tool("set_teacher_status", "直接停用或恢复教师。这不是删除。", {
      teacherId: textProp("教师 ID"),
      status: { type: "string", enum: ["ACTIVE", "INACTIVE"] },
    }, ["teacherId", "status"]),
    tool("issue_teacher_invite", "直接为教师生成登录邀请码。", { teacherId: textProp("教师 ID") }, ["teacherId"]),
    tool("update_class_group", "直接修改班级名称、主讲教师或容量。", {
      classGroupId: textProp("班级 ID"),
      name: textProp("可选，新班级名"),
      teacherId: textProp("可选，新主讲教师 ID"),
      capacity: { type: "integer", description: "可选容量，1 到 500" },
    }, ["classGroupId"]),
    tool("set_course_status", "直接归档或恢复课程。归档不是物理删除。", {
      courseId: textProp("课程 ID"),
      status: { type: "string", enum: ["ACTIVE", "ARCHIVED"] },
    }, ["courseId", "status"]),
    tool("set_class_status", "直接归档或恢复班级。归档不是物理删除。", {
      classGroupId: textProp("班级 ID"),
      status: { type: "string", enum: ["ACTIVE", "ARCHIVED"] },
    }, ["classGroupId", "status"]),
    tool("change_lesson_classroom", "直接更换课次教室。", {
      lessonId: textProp("课次 ID"),
      classroom: textProp("教室 ID 或名称"),
    }, ["lessonId", "classroom"]),
    tool("change_lesson_teacher", "直接更换课次授课教师。", {
      lessonId: textProp("课次 ID"),
      teacherId: textProp("教师 ID"),
    }, ["lessonId", "teacherId"]),
    tool("cancel_lesson", "直接取消一节尚未开始上课流程的已排课次，并按原规则退回已扣课时。这不是删除记录。", {
      lessonId: textProp("课次 ID"),
    }, ["lessonId"]),
    tool("return_report", "直接把报告退回给教师修改。", {
      reportId: textProp("报告 ID"),
      reason: textProp("退回原因，最多 200 字"),
    }, ["reportId", "reason"]),
    tool("admit_waitlist", "直接把排队学生转入班级。", { waitlistId: textProp("排队记录 ID，可先查班级排队") }, ["waitlistId"]),
    tool("update_organization", "直接修改机构名称。语言和开关保持不变。", { name: textProp("2 到 40 个字的机构名称") }, ["name"]),
  ];
}

async function lessonsInWindow(organizationId: string, startAt: Date, endAt: Date, studentIds: string[], ignoreId?: string): Promise<ExistingLesson[]> {
  const rows = await prisma.lessonSession.findMany({
    where: {
      organizationId,
      status: { not: "CANCELLED" },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
      ...(ignoreId ? { id: { not: ignoreId } } : {}),
    },
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

async function resolveClassroom(actor: Actor, classroom: string, allowUnavailable = false) {
  const value = classroom.trim();
  if (!value) return null;
  const byId = await prisma.classroom.findFirst({
    where: { id: value, organizationId: actor.organizationId, ...(allowUnavailable ? {} : { available: true }) },
    select: { id: true, name: true, capacity: true, available: true },
  });
  if (byId) return byId;
  const rows = await prisma.classroom.findMany({
    where: { organizationId: actor.organizationId, name: value, ...(allowUnavailable ? {} : { available: true }) },
    select: { id: true, name: true, capacity: true, available: true },
    take: 2,
  });
  return rows.length === 1 ? rows[0] : null;
}

async function ownClass(actor: Actor, classGroupId: string) {
  const classGroup = await prisma.classGroup.findFirst({
    where: { id: classGroupId, organizationId: actor.organizationId, status: "ACTIVE" },
    select: { id: true, name: true, courseId: true, teacherId: true, course: { select: { name: true, billingType: true } }, teacher: { select: { name: true, status: true } } },
  });
  if (!classGroup) return null;
  if (actor.area === "teacher" && classGroup.teacherId !== actor.teacherId) return null;
  return classGroup;
}

export async function runOperationRead(actor: Actor, name: string, args: Record<string, unknown>) {
  if (/delete|remove|drop|销毁/i.test(name) || name.includes("删除")) return "不能通过小星助教删除数据。";
  if (blocked(actor, name)) return denied;
  if (name === "lookup_class") return lookupClass(actor, str(args, "name"));
  if (name === "lookup_course") return lookupCourse(actor, str(args, "name"));
  if (name === "lookup_teacher") return lookupTeacher(actor, str(args, "name"));
  if (name === "lookup_lesson") return lookupLesson(actor, args);
  if (name === "get_today_overview") return todayOverview(actor);
  if (name === "get_pending_todos") return pendingTodos(actor);
  if (name === "get_teacher_schedule") return teacherSchedule(actor, str(args, "teacherName"));
  if (name === "get_audit_logs") return auditLogs(actor);
  if (name === "get_stats_summary") return statsSummary(actor);
  if (name === "get_revenue_summary") return revenueSummary(actor);
  return null;
}

async function lookupClass(actor: Actor, name: string) {
  if (!name) return "请提供班级名称。";
  const rows = await prisma.classGroup.findMany({
    where: {
      organizationId: actor.organizationId,
      status: "ACTIVE",
      name: { contains: name, mode: "insensitive" },
      ...(actor.area === "teacher" ? { teacherId: actor.teacherId ?? "__none__" } : {}),
    },
    select: { id: true, name: true, courseId: true, teacherId: true, course: { select: { name: true } }, teacher: { select: { name: true } } },
    take: 8,
  });
  if (rows.length === 0) return "没有找到这个班级。";
  return JSON.stringify(rows.map((row) => ({ id: row.id, name: row.name, courseId: row.courseId, course: row.course.name, teacherId: row.teacherId, teacher: row.teacher.name })));
}

async function lookupCourse(actor: Actor, name: string) {
  if (!name) return "请提供课程名称。";
  const rows = await prisma.course.findMany({
    where: {
      organizationId: actor.organizationId,
      status: "ACTIVE",
      name: { contains: name, mode: "insensitive" },
      ...(actor.area === "teacher" ? { classGroups: { some: { teacherId: actor.teacherId ?? "__none__", status: "ACTIVE" } } } : {}),
    },
    select: { id: true, name: true, billingType: true },
    take: 8,
  });
  if (rows.length === 0) return "没有找到这门课程。";
  return JSON.stringify(rows);
}

async function lookupTeacher(actor: Actor, name: string) {
  if (actor.area !== "owner") return denied;
  if (!name) return "请提供教师姓名。";
  const rows = await prisma.teacher.findMany({
    where: { organizationId: actor.organizationId, status: "ACTIVE", name: { contains: name, mode: "insensitive" } },
    select: { id: true, name: true, teacherNo: true },
    take: 8,
  });
  if (rows.length === 0) return "没有找到这位教师。";
  return JSON.stringify(rows);
}

async function lookupLesson(actor: Actor, args: Record<string, unknown>) {
  const date = str(args, "date");
  const title = str(args, "title");
  const studentName = str(args, "studentName");
  const range = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? { gte: new Date(`${date}T00:00:00+08:00`), lt: new Date(new Date(`${date}T00:00:00+08:00`).getTime() + 86400000) }
    : undefined;
  const rows = await prisma.lessonSession.findMany({
    where: {
      organizationId: actor.organizationId,
      status: { not: "CANCELLED" },
      ...(actor.area === "teacher" ? { teacherId: actor.teacherId ?? "__none__" } : {}),
      ...(range ? { startAt: range } : {}),
      ...(title ? { OR: [{ title: { contains: title, mode: "insensitive" } }, { course: { name: { contains: title, mode: "insensitive" } } }] } : {}),
      ...(studentName ? { students: { some: { student: { name: { contains: studentName, mode: "insensitive" }, organizationId: actor.organizationId } } } } : {}),
    },
    orderBy: { startAt: "desc" },
    take: 8,
    select: {
      id: true,
      title: true,
      startAt: true,
      teacher: { select: { name: true } },
      students: { select: { id: true, attendanceStatus: true, student: { select: { id: true, name: true } } } },
    },
  });
  if (rows.length === 0) return "没有找到课次。";
  return JSON.stringify(rows.map((row) => ({
    id: row.id,
    title: row.title,
    when: formatDateTime(row.startAt),
    teacher: row.teacher.name,
    students: row.students.map((seat) => ({ lessonStudentId: seat.id, studentId: seat.student.id, name: seat.student.name, attendance: attendanceLabel[seat.attendanceStatus] })),
  })));
}

async function todayOverview(actor: Actor) {
  if (actor.area === "teacher") {
    const today = shanghaiDateKey();
    const start = new Date(`${today}T00:00:00+08:00`);
    const end = new Date(start.getTime() + 86400000);
    const [lessons, students] = await Promise.all([
      prisma.lessonSession.findMany({
        where: { organizationId: actor.organizationId, teacherId: actor.teacherId ?? "__none__", status: { not: "CANCELLED" }, startAt: { gte: start, lt: end } },
        orderBy: { startAt: "asc" },
        select: { title: true, startAt: true, endAt: true, location: true },
      }),
      prisma.student.count({
        where: { organizationId: actor.organizationId, status: "ACTIVE", OR: [
          { enrollments: { some: { classGroup: { teacherId: actor.teacherId ?? "__none__" } } } },
          { lessonStudents: { some: { lessonSession: { teacherId: actor.teacherId ?? "__none__" } } } },
        ] },
      }),
    ]);
    return JSON.stringify({ students, lessons: lessons.map((row) => `${formatClock(row.startAt)}–${formatClock(row.endAt)} ${row.title ?? "课次"} ${row.location ?? ""}`.trim()) });
  }
  const data = await ownerOverview(actor.organizationId);
  return JSON.stringify({
    activeStudents: data.activeStudents,
    newStudentsThisMonth: data.newStudents,
    todayLessons: data.lessons.map((row) => `${formatClock(row.startAt)}–${formatClock(row.endAt)} ${row.title ?? row.course.name} ${row.teacher.name} ${row._count.students}人`),
    pendingReports: data.pendingReports,
  });
}

async function pendingTodos(actor: Actor) {
  if (actor.area === "teacher") {
    const now = new Date();
    const [records, reports] = await Promise.all([
      prisma.lessonSession.findMany({
        where: { organizationId: actor.organizationId, teacherId: actor.teacherId ?? "__none__", status: { not: "CANCELLED" }, endAt: { lte: now }, teachingRecord: { is: null } },
        orderBy: { startAt: "desc" },
        take: 12,
        select: { id: true, title: true, startAt: true },
      }),
      prisma.teachingReport.findMany({
        where: { organizationId: actor.organizationId, status: { in: ["DRAFT", "RETURNED"] }, lessonSession: { teacherId: actor.teacherId ?? "__none__" } },
        take: 12,
        select: { id: true, status: true, student: { select: { name: true } }, lessonSession: { select: { title: true } } },
      }),
    ]);
    return JSON.stringify({
      records: records.map((row) => ({ id: row.id, title: row.title, when: formatDateTime(row.startAt) })),
      reports: reports.map((row) => ({ id: row.id, student: row.student.name, title: row.lessonSession.title, status: row.status })),
    });
  }
  const data = await ownerTodoLists(actor.organizationId);
  return JSON.stringify({
    renewals: data.renewals.slice(0, 12).map((row) => `${row.studentName} · ${row.courseName} · ${row.detail}`),
    records: data.records.slice(0, 12).map((row) => `${row.title ?? "课次"} ${formatDateTime(row.startAt)}`),
    reports: data.reports.slice(0, 12).map((row) => `${row.student.name} · ${row.lessonSession.title ?? "课次"} · ${row.status}`),
    trials: data.trials.slice(0, 12).map((row) => `${row.student.name} · ${row.lessonSession.title ?? "课次"}`),
    fullClasses: data.fullQueues.slice(0, 12).map((row) => `${row.courseName} · ${row.name} 排队 ${row.waiting.length} 人`),
  });
}

async function teacherSchedule(actor: Actor, teacherName: string) {
  let teacherId = actor.teacherId;
  let teacherLabel = "我";
  if (actor.area === "owner") {
    if (!teacherName) return "请提供教师姓名。";
    const found = await prisma.teacher.findMany({
      where: { organizationId: actor.organizationId, status: "ACTIVE", name: { contains: teacherName, mode: "insensitive" } },
      select: { id: true, name: true },
      take: 2,
    });
    if (found.length !== 1) return found.length === 0 ? "没有找到这位教师。" : "有多位教师姓名相近，请说得更具体。";
    teacherId = found[0].id;
    teacherLabel = found[0].name;
  }
  const rows = await prisma.lessonSession.findMany({
    where: { organizationId: actor.organizationId, teacherId: teacherId ?? "__none__", status: { not: "CANCELLED" }, endAt: { gte: new Date() } },
    orderBy: { startAt: "asc" },
    take: 8,
    select: { id: true, title: true, startAt: true, endAt: true, location: true },
  });
  if (rows.length === 0) return `${teacherLabel}接下来没有未取消的课。`;
  return JSON.stringify(rows.map((row) => ({ id: row.id, title: row.title, when: `${formatDateTime(row.startAt)}–${formatClock(row.endAt)}`, room: row.location })));
}

async function auditLogs(actor: Actor) {
  if (actor.area !== "owner") return denied;
  const rows = await prisma.auditLog.findMany({
    where: { organizationId: actor.organizationId },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { createdAt: true, action: true, detail: true },
  });
  if (rows.length === 0) return "还没有操作记录。";
  return JSON.stringify(rows.map((row) => ({ when: formatDateTime(row.createdAt), action: row.action, detail: row.detail })));
}

async function statsSummary(actor: Actor) {
  if (actor.area !== "owner") return denied;
  const data = await ownerSnapshot(actor.organizationId);
  return JSON.stringify({
    activeStudents: data.activeStudents,
    inactiveStudents: data.inactiveStudents,
    activeTeachers: data.activeTeachers,
    todayLessons: data.todayLessons,
    upcomingLessons: data.upcomingLessons,
    pendingRecords: data.pendingRecords,
    pendingReports: data.pendingReports,
    attendanceLast7Days: data.attendance.counts,
  });
}

async function revenueSummary(actor: Actor) {
  if (actor.area !== "owner") return denied;
  const today = shanghaiDateKey();
  const [yearText, monthText] = today.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const monthStart = new Date(`${yearText}-${monthText}-01T00:00:00+08:00`);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const monthEnd = new Date(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00+08:00`);
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevStart = new Date(`${prevYear}-${String(prevMonth).padStart(2, "0")}-01T00:00:00+08:00`);
  const [thisMonth, lastMonth, voidedThisMonth] = await Promise.all([
    prisma.payment.findMany({
      where: { organizationId: actor.organizationId, voidedAt: null, paidAt: { gte: monthStart, lt: monthEnd } },
      select: { amount: true },
    }),
    prisma.payment.findMany({
      where: { organizationId: actor.organizationId, voidedAt: null, paidAt: { gte: prevStart, lt: monthStart } },
      select: { amount: true },
    }),
    prisma.payment.count({
      where: { organizationId: actor.organizationId, voidedAt: { not: null }, paidAt: { gte: monthStart, lt: monthEnd } },
    }),
  ]);
  const sum = (rows: { amount: { toString(): string } }[]) =>
    Math.round(rows.reduce((total, row) => total + Number(row.amount.toString()), 0) * 100) / 100;
  return JSON.stringify({
    timezone: "Asia/Shanghai",
    today,
    thisMonth: { label: `${month}月`, netYuan: sum(thisMonth), paymentCount: thisMonth.length, voidedCountExcluded: voidedThisMonth },
    lastMonth: { label: `${prevMonth}月`, netYuan: sum(lastMonth), paymentCount: lastMonth.length },
    note: "金额只含未作废流水，按收款时间归属上海自然月。作废流水已排除。",
  });
}

export async function previewOperation(actor: Actor, name: string, args: Record<string, unknown>): Promise<Preview> {
  if (/delete|remove|drop|销毁/i.test(name) || name.includes("删除")) return { ok: false, message: "不能通过小星助教删除数据。" };
  if (blocked(actor, name) || !operationWrites.has(name)) return { ok: false, message: denied };
  if (name === "create_student") return previewStudent(args);
  if (name === "bind_parent") return previewParent(actor, args);
  if (name === "create_teacher") return previewTeacher(actor, args);
  if (name === "assign_course_to_teacher") return previewAssign(actor, args);
  if (name === "create_course") return previewCourse(args);
  if (name === "create_class_group") return previewClass(actor, args);
  if (name === "create_classroom") return previewRoom(args);
  if (name === "edit_classroom_status") return previewRoomStatus(actor, args);
  if (name === "schedule_recurring_lessons") return previewRecurring(actor, args);
  if (name === "mark_attendance") return previewAttendance(actor, args);
  if (name === "change_lesson_time") return previewReschedule(actor, args);
  if (name === "make_up_lesson") return previewMakeup(actor, args);
  if (name === "generate_ai_report") return previewGenerate(actor, args);
  if (name === "create_enrollment") return previewEnrollment(actor, args);
  if (name === "record_payment") return previewPayment(actor, args);
  if (name === "add_waitlist") return previewWaitlist(actor, args);
  if (name === "add_follow_up") return previewFollowUp(actor, args);
  if (name === "update_student") return previewUpdateStudent(actor, args);
  if (name === "set_student_status") return previewStudentStatus(actor, args);
  if (name === "stop_enrollment") return previewStopEnrollment(actor, args);
  if (name === "set_teacher_status") return previewTeacherStatus(actor, args);
  if (name === "issue_teacher_invite") return previewTeacherInvite(actor, args);
  if (name === "update_class_group") return previewUpdateClass(actor, args);
  if (name === "set_course_status") return previewCourseStatus(actor, args);
  if (name === "set_class_status") return previewClassStatus(actor, args);
  if (name === "change_lesson_classroom") return previewChangeRoom(actor, args);
  if (name === "change_lesson_teacher") return previewChangeTeacher(actor, args);
  if (name === "cancel_lesson") return previewCancel(actor, args);
  if (name === "return_report") return previewReturn(actor, args);
  if (name === "admit_waitlist") return previewAdmit(actor, args);
  if (name === "update_organization") return previewOrg(actor, args);
  if (name === "add_lesson_student") return previewAddStudent(actor, args);
  return { ok: false, message: "不能通过小星助教执行这个操作。" };
}

function previewStudent(args: Record<string, unknown>): Preview {
  const name = str(args, "name");
  if (!name || name.length > 40) return { ok: false, message: "请提供 1 到 40 个字的学生姓名。" };
  const grade = str(args, "grade");
  const guardianName = str(args, "guardianName");
  const guardianPhone = str(args, "guardianPhone");
  return { ok: true, summary: `小星助教准备新建学生【${name}】，是否确认执行？`, detail: [grade && `年级 ${grade}`, guardianName && `家长 ${guardianName}`].filter(Boolean).join("\n"), args: { name, grade, guardianName, guardianPhone } };
}

async function previewParent(actor: Actor, args: Record<string, unknown>): Promise<Preview> {
  const studentId = str(args, "studentId");
  const student = await prisma.student.findFirst({ where: { id: studentId, organizationId: actor.organizationId, status: "ACTIVE" }, select: { id: true, name: true } });
  if (!student) return { ok: false, message: "没有找到这名在读学生。" };
  return { ok: true, summary: `小星助教准备为【${student.name}】生成家长绑定邀请码，是否确认执行？`, detail: "确认后才会生成邀请码。", args: { studentId: student.id } };
}

async function previewTeacher(actor: Actor, args: Record<string, unknown>): Promise<Preview> {
  const name = str(args, "name");
  const phone = str(args, "phone");
  const courseId = str(args, "courseId");
  if (!name || name.length > 40) return { ok: false, message: "请提供 1 到 40 个字的教师姓名。" };
  let courseName = "";
  if (courseId) {
    const course = await prisma.course.findFirst({ where: { id: courseId, organizationId: actor.organizationId, status: "ACTIVE" }, select: { name: true } });
    if (!course) return { ok: false, message: "没有找到要分配的课程。" };
    courseName = course.name;
  }
  return { ok: true, summary: `小星助教准备新建教师【${name}】${courseName ? `，并分配【${courseName}】` : ""}，是否确认执行？`, detail: "", args: { name, phone, courseId } };
}

async function previewAssign(actor: Actor, args: Record<string, unknown>): Promise<Preview> {
  const teacher = await prisma.teacher.findFirst({ where: { id: str(args, "teacherId"), organizationId: actor.organizationId, status: "ACTIVE" }, select: { id: true, name: true } });
  const course = await prisma.course.findFirst({ where: { id: str(args, "courseId"), organizationId: actor.organizationId, status: "ACTIVE" }, select: { id: true, name: true } });
  if (!teacher || !course) return { ok: false, message: "没有找到这位在职教师或这门课程。" };
  return { ok: true, summary: `小星助教准备为【${teacher.name}】追加授课课程【${course.name}】，是否确认执行？`, detail: "已有课程会保留。", args: { teacherId: teacher.id, courseId: course.id } };
}

function previewCourse(args: Record<string, unknown>): Preview {
  const name = str(args, "name");
  const billingType = str(args, "billingType");
  if (!name || name.length > 40) return { ok: false, message: "请提供 1 到 40 个字的课程名称。" };
  if (billingType !== "PER_LESSON" && billingType !== "PER_PERIOD") return { ok: false, message: "计费方式只能是按课时或按周期。" };
  return { ok: true, summary: `小星助教准备创建课程【${name}】，计费为${billingType === "PER_LESSON" ? "按课时" : "按周期"}，是否确认执行？`, detail: "", args: { name, billingType, description: str(args, "description").slice(0, 200) } };
}

async function previewClass(actor: Actor, args: Record<string, unknown>): Promise<Preview> {
  const name = str(args, "name");
  const course = await prisma.course.findFirst({ where: { id: str(args, "courseId"), organizationId: actor.organizationId, status: "ACTIVE" }, select: { id: true, name: true } });
  const teacher = await prisma.teacher.findFirst({ where: { id: str(args, "teacherId"), organizationId: actor.organizationId, status: "ACTIVE" }, select: { id: true, name: true } });
  const capacity = Number(args.capacity);
  if (!name || name.length > 40) return { ok: false, message: "请提供 1 到 40 个字的班级名称。" };
  if (!course || !teacher) return { ok: false, message: "没有找到课程或在职教师。" };
  if (args.capacity != null && args.capacity !== "" && (!Number.isInteger(capacity) || capacity < 1 || capacity > 500)) return { ok: false, message: "容量需要是 1 到 500 的整数。" };
  return { ok: true, summary: `小星助教准备新建班级【${name}】，课程【${course.name}】，教师【${teacher.name}】，是否确认执行？`, detail: "", args: { name, courseId: course.id, teacherId: teacher.id, capacity: Number.isInteger(capacity) ? capacity : "" } };
}

function previewRoom(args: Record<string, unknown>): Preview {
  const name = str(args, "name");
  const capacity = Number(args.capacity);
  if (!name || name.length > 40) return { ok: false, message: "请提供 1 到 40 个字的教室名称。" };
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) return { ok: false, message: "容量需要是 1 到 500 的整数。" };
  return { ok: true, summary: `小星助教准备新增教室【${name}】，容量 ${capacity}，是否确认执行？`, detail: "", args: { name, capacity } };
}

async function previewRoomStatus(actor: Actor, args: Record<string, unknown>): Promise<Preview> {
  const room = await resolveClassroom(actor, str(args, "classroom"), true);
  if (!room) return { ok: false, message: "没有找到唯一的教室。" };
  const available = args.available === true || args.available === "true" || args.available === 1 || args.available === "1";
  return { ok: true, summary: `小星助教准备${available ? "启用" : "停用"}教室【${room.name}】，是否确认执行？`, detail: available ? "" : "停用后新排课不能再选这间教室，已有课次会保留。", args: { classroomId: room.id, available: available ? 1 : 0 } };
}

async function previewRecurring(actor: Actor, args: Record<string, unknown>): Promise<Preview> {
  const classGroup = await ownClass(actor, str(args, "classGroupId"));
  const startDate = str(args, "startDate");
  const endDate = str(args, "endDate");
  const startTime = str(args, "startTime");
  const endTime = str(args, "endTime");
  const weekdays = str(args, "weekdays").split(",").map((item) => item.trim()).filter((item) => /^[0-6]$/.test(item));
  if (!classGroup) return { ok: false, message: "只能为当前机构、且你有权限的启用班级排课。" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate) return { ok: false, message: "请提供有效的开始和结束日期。" };
  if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime) || endTime <= startTime) return { ok: false, message: "请提供同一天内、结束晚于开始的时间。" };
  if (weekdays.length === 0) return { ok: false, message: "请用 0 到 6 指定星期，例如 1,3,5。" };
  const room = await resolveClassroom(actor, str(args, "classroom"));
  if (!room) return { ok: false, message: "没有找到唯一的可用教室。" };
  const enrolled = await prisma.enrollment.count({ where: { organizationId: actor.organizationId, classGroupId: classGroup.id, student: { status: "ACTIVE" } } });
  const seats = roomCapacityWarning(enrolled, room.capacity, room.name);
  return {
    ok: true,
    summary: `小星助教准备为【${classGroup.course.name} · ${classGroup.name}】按星期排课，${startDate} 至 ${endDate} ${startTime}–${endTime}，教室【${room.name}】，是否确认执行？`,
    detail: [seats, "冲突的日期会跳过，其余日期会写入。"].filter(Boolean).join("\n"),
    args: { classGroupId: classGroup.id, startDate, endDate, startTime, endTime, classroomId: room.id, weekdays: weekdays.join(","), skipWeekends: args.skipWeekends === true || args.skipWeekends === "true" ? 1 : 0 },
  };
}

async function previewAttendance(actor: Actor, args: Record<string, unknown>): Promise<Preview> {
  const fields = toAttendanceFields(str(args, "status"));
  if (!fields || fields.status === "NOT_MARKED") return { ok: false, message: "考勤状态只能是出勤、迟到、缺勤、事假或病假。" };
  const lesson = await prisma.lessonSession.findFirst({
    where: { id: str(args, "lessonId"), organizationId: actor.organizationId, status: { not: "CANCELLED" }, ...(actor.area === "teacher" ? { teacherId: actor.teacherId ?? "__none__" } : {}) },
    select: { id: true, title: true, students: { where: { studentId: str(args, "studentId") }, select: { student: { select: { id: true, name: true, status: true } } } } },
  });
  const seat = lesson?.students[0];
  if (!lesson || !seat || seat.student.status !== "ACTIVE") return { ok: false, message: "没有找到这节课上的这名在读学生，或你不能给这节课点名。" };
  const note = str(args, "note");
  if (note.length > 80) return { ok: false, message: "备注不能超过 80 个字。" };
  const status = fields.leaveKind ?? fields.status;
  return { ok: true, summary: `小星助教准备把【${seat.student.name}】在【${lesson.title ?? "课次"}】的考勤记为【${attendanceDisplayLabel(fields.status, fields.leaveKind)}】，是否确认执行？`, detail: note, args: { lessonId: lesson.id, studentId: seat.student.id, status, note } };
}

async function previewReschedule(actor: Actor, args: Record<string, unknown>): Promise<Preview> {
  const startAt = parseShanghaiDateTime(str(args, "startAt"));
  const endAt = parseShanghaiDateTime(str(args, "endAt"));
  if (!startAt || !endAt || endAt <= startAt) return { ok: false, message: "请提供有效的开始和结束时间。" };
  const lesson = await prisma.lessonSession.findFirst({
    where: { id: str(args, "lessonId"), organizationId: actor.organizationId, status: { not: "CANCELLED" }, ...(actor.area === "teacher" ? { teacherId: actor.teacherId ?? "__none__" } : {}) },
    select: { id: true, title: true, startAt: true, location: true, classroomId: true, classGroupId: true, teacherId: true, students: { select: { studentId: true, hoursCharged: true } } },
  });
  if (!lesson) return { ok: false, message: "没有找到这节课，或你不能修改它。" };
  const conflicts = findScheduleConflicts({
    teacherId: lesson.teacherId,
    classGroupId: lesson.classGroupId,
    location: lesson.location,
    classroomId: lesson.classroomId,
    studentIds: lesson.students.map((row) => row.studentId),
    startAt,
    endAt,
  }, await lessonsInWindow(actor.organizationId, startAt, endAt, lesson.students.map((row) => row.studentId), lesson.id));
  const charged = lesson.students.some((row) => row.hoursCharged);
  return {
    ok: true,
    summary: actor.area === "teacher"
      ? `小星助教准备提交【${lesson.title ?? "课次"}】的调课申请，从 ${formatDateTime(lesson.startAt)} 改到 ${formatDateTime(startAt)}–${formatClock(endAt)}。负责人同意前，上课时间不变。是否确认提交？`
      : `小星助教准备把【${lesson.title ?? "课次"}】从 ${formatDateTime(lesson.startAt)} 改到 ${formatDateTime(startAt)}–${formatClock(endAt)}，是否确认执行？`,
    detail: [charged ? "这节课已有学生扣过课时。改时间不会退回已扣课时。" : "", conflicts.length > 0 ? singleConflictWarning(conflicts, formatDateTime, "确认后仍会修改。") : ""].filter(Boolean).join("\n"),
    args: { lessonId: lesson.id, startAt: startAt.toISOString(), endAt: endAt.toISOString() },
  };
}

async function previewMakeup(actor: Actor, args: Record<string, unknown>): Promise<Preview> {
  const source = await prisma.lessonStudent.findFirst({
    where: { id: str(args, "sourceLessonStudentId"), organizationId: actor.organizationId, attendanceStatus: "LEAVE" },
    select: { id: true, student: { select: { name: true } }, lessonSession: { select: { id: true, title: true, teacherId: true, courseId: true, status: true } } },
  });
  const target = await prisma.lessonSession.findFirst({
    where: { id: str(args, "targetLessonId"), organizationId: actor.organizationId, status: { not: "CANCELLED" } },
    select: { id: true, title: true, teacherId: true, courseId: true, startAt: true },
  });
  if (!source || source.lessonSession.status === "CANCELLED" || !target) return { ok: false, message: "只能把未取消课次上的请假，补到另一节未取消的课。" };
  if (actor.area === "teacher" && (source.lessonSession.teacherId !== actor.teacherId || target.teacherId !== actor.teacherId)) return { ok: false, message: "只能为自己的课次安排补课。" };
  if (target.courseId !== source.lessonSession.courseId || target.id === source.lessonSession.id) return { ok: false, message: "补课必须是同一门课的另一节。" };
  return { ok: true, summary: `小星助教准备把【${source.student.name}】补到【${target.title ?? "课次"}】${formatDateTime(target.startAt)}，是否确认执行？`, detail: "点名时按正常出勤扣课时，原来的请假不扣。", args: { sourceLessonStudentId: source.id, targetLessonId: target.id } };
}

async function previewGenerate(actor: Actor, args: Record<string, unknown>): Promise<Preview> {
  const lesson = await prisma.lessonSession.findFirst({
    where: { id: str(args, "lessonId"), organizationId: actor.organizationId, status: { not: "CANCELLED" }, ...(actor.area === "teacher" ? { teacherId: actor.teacherId ?? "__none__" } : {}) },
    select: { id: true, title: true, teachingRecord: { select: { id: true } }, students: { select: { studentId: true } } },
  });
  if (!lesson) return { ok: false, message: "没有找到这节课，或你不能为它生成报告。" };
  if (lesson.students.length === 0) return { ok: false, message: "这节课没有学生，无法生成报告。" };
  const lessonContent = str(args, "lessonContent");
  if (!lesson.teachingRecord && !lessonContent) return { ok: false, message: "这节课还没有教学记录。请在同一次请求里提供教学内容。" };
  if (lessonContent.length > 2000) return { ok: false, message: "教学内容不能超过 2000 个字。" };
  return {
    ok: true,
    summary: `小星助教准备为【${lesson.title ?? "课次"}】生成教学记录和报告草稿，是否确认执行？`,
    detail: `名单上有 ${lesson.students.length} 名学生。已确认或已发布的报告不会被覆盖。`,
    args: { lessonId: lesson.id, lessonContent, studentPerformance: str(args, "studentPerformance").slice(0, 2000), difficulties: str(args, "difficulties").slice(0, 2000), homework: str(args, "homework").slice(0, 2000) },
  };
}

async function previewEnrollment(actor: Actor, args: Record<string, unknown>): Promise<Preview> {
  const student = await prisma.student.findFirst({ where: { id: str(args, "studentId"), organizationId: actor.organizationId, status: "ACTIVE" }, select: { id: true, name: true, guardianName: true, guardianPhone: true } });
  const course = await prisma.course.findFirst({ where: { id: str(args, "courseId"), organizationId: actor.organizationId, status: "ACTIVE" }, select: { id: true, name: true, billingType: true } });
  const classGroup = await prisma.classGroup.findFirst({ where: { id: str(args, "classGroupId"), organizationId: actor.organizationId, courseId: course?.id, status: "ACTIVE" }, select: { id: true, name: true } });
  if (!student || !course || !classGroup) return { ok: false, message: "学生、课程或班级不存在，或不属于当前机构。" };
  if (!student.guardianName || !student.guardianPhone) return { ok: false, message: "这名学生还没有家长姓名和电话，请先到学生档案补齐后再报名。" };
  const amountDue = str(args, "amountDue");
  const amountPaid = str(args, "amountPaid");
  if (!/^\d+(\.\d{1,2})?$/.test(amountDue) || !/^\d+(\.\d{1,2})?$/.test(amountPaid)) return { ok: false, message: "应收和实收需要是最多两位小数的金额。" };
  const rawMethod = str(args, "payMethod");
  const payMethod = isPaymentMethod(rawMethod) ? rawMethod : "CASH";
  return { ok: true, summary: `小星助教准备为【${student.name}】报名【${course.name} · ${classGroup.name}】，方式【${paymentMethodLabel[payMethod]}】，应收 ${amountDue} 元，实收 ${amountPaid} 元，是否确认执行？`, detail: "", args: { studentId: student.id, courseId: course.id, classGroupId: classGroup.id, amountDue, amountPaid, hours: Number(args.hours) || 0, payMethod, discountPercent: str(args, "discountPercent"), startDate: str(args, "startDate"), endDate: str(args, "endDate") } };
}

async function previewPayment(actor: Actor, args: Record<string, unknown>): Promise<Preview> {
  const enrollment = await prisma.enrollment.findFirst({
    where: { organizationId: actor.organizationId, studentId: str(args, "studentId"), courseId: str(args, "courseId") },
    orderBy: { createdAt: "desc" },
    select: { id: true, student: { select: { name: true } }, course: { select: { name: true } } },
  });
  const amount = str(args, "amount");
  const method = str(args, "method");
  const kind = str(args, "kind") === "refund" ? "refund" : "collect";
  const reason = str(args, "reason");
  if (!enrollment) return { ok: false, message: "没有找到这名学生的这门报名。" };
  if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) return { ok: false, message: "金额需要大于 0，最多两位小数。" };
  if (!isPaymentMethod(method)) return { ok: false, message: "请选择收款方式。" };
  if (kind === "refund" && (!reason || reason.length > 80)) return { ok: false, message: "退费原因需要 1 到 80 个字。" };
  return { ok: true, summary: `小星助教准备为【${enrollment.student.name}】的【${enrollment.course.name}】${kind === "refund" ? "退费" : "收款"} ${amount} 元，方式【${paymentMethodLabel[method]}】，是否确认执行？`, detail: reason, args: { enrollmentId: enrollment.id, amount, method, kind, reason } };
}

async function previewWaitlist(actor: Actor, args: Record<string, unknown>): Promise<Preview> {
  const student = await prisma.student.findFirst({ where: { id: str(args, "studentId"), organizationId: actor.organizationId, status: "ACTIVE" }, select: { id: true, name: true } });
  const classGroup = await prisma.classGroup.findFirst({ where: { id: str(args, "classGroupId"), organizationId: actor.organizationId, status: "ACTIVE" }, select: { id: true, name: true } });
  if (!student || !classGroup) return { ok: false, message: "没有找到这名学生或这个班级。" };
  return { ok: true, summary: `小星助教准备把【${student.name}】加入【${classGroup.name}】的排队，是否确认执行？`, detail: "排队期间不算在读，也不会进入课表。", args: { studentId: student.id, classGroupId: classGroup.id } };
}

async function previewFollowUp(actor: Actor, args: Record<string, unknown>): Promise<Preview> {
  const outcome = str(args, "outcome");
  if (!["TO_CONTACT", "CONTACTED", "NEXT_BOOKED", "DECLINED"].includes(outcome)) return { ok: false, message: "请选择跟进结果。" };
  const student = await prisma.student.findFirst({ where: { id: str(args, "studentId"), organizationId: actor.organizationId }, select: { id: true, name: true } });
  const course = await prisma.course.findFirst({ where: { id: str(args, "courseId"), organizationId: actor.organizationId }, select: { id: true, name: true } });
  if (!student || !course) return { ok: false, message: "学生或课程不属于当前机构。" };
  const labels: Record<string, string> = { TO_CONTACT: "待联系", CONTACTED: "已联系", NEXT_BOOKED: "已约下次", DECLINED: "暂不续费" };
  return { ok: true, summary: `小星助教准备记录【${student.name}】的【${course.name}】续费跟进，结果【${labels[outcome]}】，是否确认执行？`, detail: str(args, "note").slice(0, 200), args: { studentId: student.id, courseId: course.id, outcome, note: str(args, "note").slice(0, 200), nextContactOn: str(args, "nextContactOn") } };
}

async function previewUpdateStudent(actor: Actor, args: Record<string, unknown>): Promise<Preview> {
  const student = await prisma.student.findFirst({
    where: { id: str(args, "studentId"), organizationId: actor.organizationId },
    select: { id: true, name: true, studentNo: true, grade: true, age: true, guardianName: true, guardianPhone: true, contactNote: true },
  });
  if (!student?.studentNo) return { ok: false, message: "没有找到这名学生，或学生还没有编号。" };
  const name = str(args, "name") || student.name;
  return {
    ok: true,
    summary: `修改【${student.name}】的档案`,
    detail: "",
    args: { studentId: student.id, name, studentNo: student.studentNo, grade: str(args, "grade") || student.grade || "", age: str(args, "age") || (student.age ?? ""), guardianName: str(args, "guardianName") || student.guardianName || "", guardianPhone: str(args, "guardianPhone") || student.guardianPhone || "", contactNote: student.contactNote || "" },
  };
}

async function previewStudentStatus(actor: Actor, args: Record<string, unknown>): Promise<Preview> {
  const status = str(args, "status");
  if (status !== "ACTIVE" && status !== "INACTIVE") return { ok: false, message: "状态只能是在读或停用。" };
  const student = await prisma.student.findFirst({ where: { id: str(args, "studentId"), organizationId: actor.organizationId }, select: { id: true, name: true } });
  if (!student) return { ok: false, message: "没有找到这名学生。" };
  return { ok: true, summary: `${status === "INACTIVE" ? "停用" : "恢复"}【${student.name}】`, detail: "历史课次和报告会保留。", args: { studentId: student.id, status } };
}

async function previewStopEnrollment(actor: Actor, args: Record<string, unknown>): Promise<Preview> {
  const reason = str(args, "reason");
  if (!reason || reason.length > 80) return { ok: false, message: "请填写 1 到 80 个字的停用原因。" };
  const student = await prisma.student.findFirst({ where: { id: str(args, "studentId"), organizationId: actor.organizationId }, select: { id: true, name: true } });
  const course = await prisma.course.findFirst({ where: { id: str(args, "courseId"), organizationId: actor.organizationId }, select: { id: true, name: true } });
  if (!student || !course) return { ok: false, message: "学生或课程不属于当前机构。" };
  return { ok: true, summary: `停用【${student.name}】的【${course.name}】报名`, detail: reason, args: { studentId: student.id, courseId: course.id, reason } };
}

async function previewTeacherStatus(actor: Actor, args: Record<string, unknown>): Promise<Preview> {
  const status = str(args, "status");
  if (status !== "ACTIVE" && status !== "INACTIVE") return { ok: false, message: "状态只能是在职或停用。" };
  const teacher = await prisma.teacher.findFirst({ where: { id: str(args, "teacherId"), organizationId: actor.organizationId }, select: { id: true, name: true } });
  if (!teacher) return { ok: false, message: "没有找到这位教师。" };
  if (status === "INACTIVE") {
    const futureCount = await prisma.lessonSession.count({
      where: { organizationId: actor.organizationId, teacherId: teacher.id, status: { not: "CANCELLED" }, startAt: { gt: new Date() } },
    });
    if (futureCount > 0) {
      return { ok: false, message: `「${teacher.name}」还有 ${futureCount} 节未开始的课。请先更换这些课的授课教师，再停用。` };
    }
  }
  return { ok: true, summary: `${status === "INACTIVE" ? "停用" : "恢复"}教师【${teacher.name}】`, detail: status === "INACTIVE" ? "确认后档案保留，新排课不能再选这位老师。" : "", args: { teacherId: teacher.id, status } };
}

async function previewTeacherInvite(actor: Actor, args: Record<string, unknown>): Promise<Preview> {
  const teacher = await prisma.teacher.findFirst({ where: { id: str(args, "teacherId"), organizationId: actor.organizationId }, select: { id: true, name: true } });
  if (!teacher) return { ok: false, message: "没有找到这位教师。" };
  return { ok: true, summary: `为【${teacher.name}】生成登录邀请码`, detail: "", args: { teacherId: teacher.id } };
}

async function previewUpdateClass(actor: Actor, args: Record<string, unknown>): Promise<Preview> {
  const classGroup = await prisma.classGroup.findFirst({ where: { id: str(args, "classGroupId"), organizationId: actor.organizationId, status: "ACTIVE" }, select: { id: true, name: true, teacherId: true, capacity: true } });
  if (!classGroup) return { ok: false, message: "没有找到这个启用中的班级。" };
  const teacherId = str(args, "teacherId") || classGroup.teacherId;
  const teacher = await prisma.teacher.findFirst({ where: { id: teacherId, organizationId: actor.organizationId, status: "ACTIVE" }, select: { id: true, name: true } });
  if (!teacher) return { ok: false, message: "没有找到在职教师。" };
  const capacity = args.capacity == null || args.capacity === "" ? classGroup.capacity ?? "" : Number(args.capacity);
  let detail = "";
  if (typeof capacity === "number" && Number.isInteger(capacity)) {
    const enrolled = await prisma.enrollment.findMany({
      where: { organizationId: actor.organizationId, classGroupId: classGroup.id, student: { status: "ACTIVE" } },
      select: { studentId: true },
    });
    const count = new Set(enrolled.map((row) => row.studentId)).size;
    if (count > capacity) detail = `当前在读 ${count} 人，容量将改为 ${capacity}，班级会显示超员，排队也不能再转入。`;
  }
  return { ok: true, summary: `修改班级【${classGroup.name}】`, detail, args: { classGroupId: classGroup.id, name: str(args, "name") || classGroup.name, teacherId: teacher.id, capacity } };
}

async function previewCourseStatus(actor: Actor, args: Record<string, unknown>): Promise<Preview> {
  const status = str(args, "status");
  if (status !== "ACTIVE" && status !== "ARCHIVED") return { ok: false, message: "课程状态无效。" };
  const course = await prisma.course.findFirst({ where: { id: str(args, "courseId"), organizationId: actor.organizationId }, select: { id: true, name: true } });
  if (!course) return { ok: false, message: "没有找到这门课程。" };
  return { ok: true, summary: `${status === "ARCHIVED" ? "归档" : "恢复"}课程【${course.name}】`, detail: "归档后仍保留历史报名和课次。", args: { courseId: course.id, status } };
}

async function previewClassStatus(actor: Actor, args: Record<string, unknown>): Promise<Preview> {
  const status = str(args, "status");
  if (status !== "ACTIVE" && status !== "ARCHIVED") return { ok: false, message: "班级状态无效。" };
  const classGroup = await prisma.classGroup.findFirst({ where: { id: str(args, "classGroupId"), organizationId: actor.organizationId }, select: { id: true, name: true } });
  if (!classGroup) return { ok: false, message: "没有找到这个班级。" };
  return { ok: true, summary: `${status === "ARCHIVED" ? "归档" : "恢复"}班级【${classGroup.name}】`, detail: "", args: { classGroupId: classGroup.id, status } };
}

async function previewChangeRoom(actor: Actor, args: Record<string, unknown>): Promise<Preview> {
  const lesson = await prisma.lessonSession.findFirst({ where: { id: str(args, "lessonId"), organizationId: actor.organizationId, status: { not: "CANCELLED" } }, select: { id: true, title: true } });
  const room = await resolveClassroom(actor, str(args, "classroom"));
  if (!lesson || !room) return { ok: false, message: "没有找到课次或可用教室。" };
  return { ok: true, summary: `把【${lesson.title ?? "课次"}】换到教室【${room.name}】`, detail: "", args: { lessonId: lesson.id, classroomId: room.id } };
}

async function previewChangeTeacher(actor: Actor, args: Record<string, unknown>): Promise<Preview> {
  const lesson = await prisma.lessonSession.findFirst({ where: { id: str(args, "lessonId"), organizationId: actor.organizationId, status: { not: "CANCELLED" } }, select: { id: true, title: true } });
  const teacher = await prisma.teacher.findFirst({ where: { id: str(args, "teacherId"), organizationId: actor.organizationId, status: "ACTIVE" }, select: { id: true, name: true } });
  if (!lesson || !teacher) return { ok: false, message: "没有找到课次或在职教师。" };
  return { ok: true, summary: `把【${lesson.title ?? "课次"}】的教师换成【${teacher.name}】`, detail: "", args: { lessonId: lesson.id, teacherId: teacher.id } };
}

async function previewCancel(actor: Actor, args: Record<string, unknown>): Promise<Preview> {
  const lesson = await prisma.lessonSession.findFirst({ where: { id: str(args, "lessonId"), organizationId: actor.organizationId, status: "SCHEDULED" }, select: { id: true, title: true, startAt: true } });
  if (!lesson) return { ok: false, message: "只能取消仍是已排课状态的课次。" };
  return { ok: true, summary: `取消【${lesson.title ?? "课次"}】${formatDateTime(lesson.startAt)}`, detail: "已扣课时会按原规则退回。课次记录会保留为已取消。", args: { lessonId: lesson.id } };
}

async function previewReturn(actor: Actor, args: Record<string, unknown>): Promise<Preview> {
  const reason = str(args, "reason");
  if (!reason || reason.length > 200) return { ok: false, message: "请填写不超过 200 字的退回原因。" };
  const report = await prisma.teachingReport.findFirst({ where: { id: str(args, "reportId"), organizationId: actor.organizationId }, select: { id: true, student: { select: { name: true } } } });
  if (!report) return { ok: false, message: "没有找到这份报告。" };
  return { ok: true, summary: `退回【${report.student.name}】的报告`, detail: reason, args: { reportId: report.id, reason } };
}

async function previewAdmit(actor: Actor, args: Record<string, unknown>): Promise<Preview> {
  const row = await prisma.classWaitlist.findFirst({ where: { id: str(args, "waitlistId"), organizationId: actor.organizationId }, select: { id: true, student: { select: { name: true } }, classGroup: { select: { name: true } } } });
  if (!row) return { ok: false, message: "没有找到这条排队记录。" };
  return { ok: true, summary: `把【${row.student.name}】从排队转入【${row.classGroup.name}】`, detail: "", args: { waitlistId: row.id } };
}

async function previewOrg(actor: Actor, args: Record<string, unknown>): Promise<Preview> {
  const name = str(args, "name");
  if (name.length < 2 || name.length > 40) return { ok: false, message: "机构名称需要 2 到 40 个字。" };
  const org = await prisma.organization.findFirst({ where: { id: actor.organizationId }, select: { name: true } });
  if (!org) return { ok: false, message: "没有找到当前机构。" };
  return { ok: true, summary: `把机构名称从【${org.name}】改为【${name}】`, detail: "", args: { name } };
}

async function previewAddStudent(actor: Actor, args: Record<string, unknown>): Promise<Preview> {
  const lesson = await prisma.lessonSession.findFirst({
    where: { id: str(args, "lessonId"), organizationId: actor.organizationId, status: { not: "CANCELLED" }, ...(actor.area === "teacher" ? { teacherId: actor.teacherId ?? "__none__" } : {}) },
    select: { id: true, title: true, startAt: true },
  });
  const student = await prisma.student.findFirst({ where: { id: str(args, "studentId"), organizationId: actor.organizationId, status: "ACTIVE" }, select: { id: true, name: true } });
  const seat = str(args, "seat");
  if (!lesson || !student) return { ok: false, message: "没有找到课次或在读学生，或你不能修改这节课。" };
  if (actor.area === "teacher" && lesson.startAt.getTime() <= Date.now()) return { ok: false, message: "课次已经开始，不能再改名单。" };
  if (!["ENROLLED", "TRIAL", "GUEST"].includes(seat)) return { ok: false, message: "请选择本班、试听或临时。" };
  return { ok: true, summary: `把【${student.name}】加入【${lesson.title ?? "课次"}】`, detail: "", args: { lessonId: lesson.id, studentId: student.id, seat } };
}

async function executeOrg(actor: Actor, name: string) {
  const org = await prisma.organization.findFirst({
    where: { id: actor.organizationId },
    select: { reportLanguage: true, businessTypes: true, aiUseRecentSummaries: true, aiRequireEvidence: true, aiTeacherMustConfirm: true, aiOwnerSpotCheck: true },
  });
  if (!org) return { ok: false as const, message: "没有找到当前机构。" };
  const data = form({ name, reportLanguage: org.reportLanguage });
  for (const type of org.businessTypes) data.append("businessTypes", type);
  if (org.aiUseRecentSummaries) data.set("aiUseRecentSummaries", "on");
  if (org.aiRequireEvidence) data.set("aiRequireEvidence", "on");
  if (org.aiTeacherMustConfirm) data.set("aiTeacherMustConfirm", "on");
  if (org.aiOwnerSpotCheck) data.set("aiOwnerSpotCheck", "on");
  const result = await saveOrganizationSettings(data);
  return { ok: result.ok, message: result.message || (result.ok ? "机构名称已更新。" : "没有更新机构名称。") };
}

async function executeAddStudent(actor: Actor, args: Record<string, string | number>) {
  const data = form({ studentId: args.studentId, seat: args.seat, acknowledgeConflict: "1" });
  if (actor.area === "teacher") {
    const result = await addTeacherLessonStudent(String(args.lessonId), data);
    return { ok: result.ok, message: result.message || result.warning || "没有加入课次。" };
  }
  const lesson = await prisma.lessonSession.findFirst({
    where: { id: String(args.lessonId), organizationId: actor.organizationId, status: { not: "CANCELLED" } },
    select: { id: true, title: true, classGroupId: true, students: { select: { studentId: true } } },
  });
  const student = await prisma.student.findFirst({ where: { id: String(args.studentId), organizationId: actor.organizationId, status: "ACTIVE" }, select: { id: true, name: true } });
  if (!lesson || !student) return { ok: false as const, message: "没有找到课次或在读学生。" };
  if (lesson.students.some((row) => row.studentId === student.id)) return { ok: false as const, message: "这名学生已经在这节课的名单里。" };
  const enrolledHere = await prisma.enrollment.findFirst({ where: { organizationId: actor.organizationId, studentId: student.id, classGroupId: lesson.classGroupId, student: { status: "ACTIVE" } }, select: { id: true } });
  const requested = String(args.seat);
  const seat = enrolledHere ? "ENROLLED" : requested === "TRIAL" || requested === "GUEST" ? requested : null;
  if (!seat) return { ok: false as const, message: "不是本班学生时，请选择临时或试听。" };
  await prisma.lessonStudent.create({ data: { organizationId: actor.organizationId, lessonSessionId: lesson.id, studentId: student.id, seat, lastAction: seat === "TRIAL" ? "加入试听" : seat === "GUEST" ? "临时加入" : "加入课次" } });
  return { ok: true as const, message: `已把${student.name}加入「${lesson.title ?? "课次"}」。` };
}

function form(entries: Record<string, string | number | undefined>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined || value === "") continue;
    data.append(key, String(value));
  }
  return data;
}

function actionText(result: { ok: boolean; message?: string; fieldErrors?: Record<string, string | undefined> }) {
  if (result.ok) return result.message || "已完成。";
  const fields = result.fieldErrors ? Object.values(result.fieldErrors).filter(Boolean).join("；") : "";
  return result.message || fields || "没有写入成功。";
}

function refreshPages() {
  for (const path of ["/owner", "/owner/todos", "/owner/students", "/owner/teachers", "/owner/courses", "/owner/rooms", "/owner/schedule", "/owner/reports", "/owner/billing", "/owner/audit", "/owner/stats", "/teacher", "/teacher/schedule", "/teacher/records", "/teacher/reports"]) {
    revalidatePath(path);
  }
}

export async function executeOperation(actor: Actor, name: string, args: Record<string, string | number>) {
  if (blocked(actor, name) || !operationWrites.has(name)) return { ok: false as const, message: denied };
  try {
    const result = await runExecute(actor, name, args);
    if (result.ok) refreshPages();
    return result;
  } catch (error) {
    if (error instanceof CourseHourError || error instanceof AiReportError) return { ok: false as const, message: error.message };
    if (typeof error === "object" && error && "digest" in error && String(error.digest).startsWith("NEXT_REDIRECT")) return { ok: false as const, message: denied };
    return { ok: false as const, message: "没有写入成功，请稍后再试。" };
  }
}

async function runExecute(actor: Actor, name: string, args: Record<string, string | number>) {
  if (name === "create_student") {
    const result = await createStudent(form({ name: args.name, grade: args.grade, guardianName: args.guardianName, guardianPhone: args.guardianPhone }));
    return { ok: result.ok, message: actionText(result) };
  }
  if (name === "bind_parent") {
    const result = await issueParentInvite(String(args.studentId));
    return { ok: result.ok, message: result.ok && result.code ? `已生成家长邀请码：${result.code}` : result.message || "没有生成邀请码。" };
  }
  if (name === "create_teacher") {
    const result = await createTeacher(form({ name: args.name, phone: args.phone, courseIds: args.courseId }));
    return { ok: result.ok, message: actionText(result) };
  }
  if (name === "assign_course_to_teacher") {
    const [teacher, course] = await Promise.all([
      prisma.teacher.findFirst({ where: { id: String(args.teacherId), organizationId: actor.organizationId, status: "ACTIVE" }, select: { id: true } }),
      prisma.course.findFirst({ where: { id: String(args.courseId), organizationId: actor.organizationId, status: "ACTIVE" }, select: { id: true } }),
    ]);
    if (!teacher || !course) return { ok: false as const, message: "没有找到这位在职教师或这门课程。" };
    await prisma.teacherCourse.createMany({ data: [{ teacherId: teacher.id, courseId: course.id }], skipDuplicates: true });
    return { ok: true as const, message: "已分配授课课程。" };
  }
  if (name === "create_course") {
    const result = await createCourse(form({ name: args.name, billingType: args.billingType, description: args.description }));
    return { ok: result.ok, message: actionText(result) };
  }
  if (name === "create_class_group") {
    const result = await createClassGroup(form({ name: args.name, courseId: args.courseId, teacherId: args.teacherId, capacity: args.capacity }));
    return { ok: result.ok, message: actionText(result) };
  }
  if (name === "create_classroom") {
    const result = await createClassroom(form({ name: args.name, capacity: args.capacity, available: "1" }));
    return { ok: result.ok, message: actionText(result) };
  }
  if (name === "edit_classroom_status") {
    const room = await prisma.classroom.findFirst({ where: { id: String(args.classroomId), organizationId: actor.organizationId }, select: { id: true, name: true, capacity: true } });
    if (!room) return { ok: false as const, message: "这间教室不存在。" };
    const result = await updateClassroom(room.id, form({ name: room.name, capacity: room.capacity, available: args.available === 1 ? "1" : "0", confirmDisable: "1" }));
    return { ok: result.ok, message: actionText(result) };
  }
  if (name === "schedule_recurring_lessons") return executeRecurring(actor, args);
  if (name === "mark_attendance") return executeAttendance(actor, args);
  if (name === "change_lesson_time") return executeReschedule(actor, args);
  if (name === "make_up_lesson") {
    const data = form({ targetLessonId: args.targetLessonId });
    const result = actor.area === "owner"
      ? await scheduleMakeup(String(args.sourceLessonStudentId), data)
      : await teacherMakeup(actor, String(args.sourceLessonStudentId), String(args.targetLessonId));
    return { ok: result.ok, message: result.message || (result.ok ? "已安排补课。" : "没有安排补课。") };
  }
  if (name === "generate_ai_report") return executeGenerate(actor, args);
  if (name === "create_enrollment") {
    const student = await prisma.student.findFirst({ where: { id: String(args.studentId), organizationId: actor.organizationId }, select: { guardianName: true, guardianPhone: true } });
    const result = await createEnrollment(form({
      mode: "existing",
      studentId: args.studentId,
      guardianName: student?.guardianName ?? "",
      guardianPhone: student?.guardianPhone ?? "",
      count: 1,
      "courseId:0": args.courseId,
      "classGroupId:0": args.classGroupId,
      "amountDue:0": args.amountDue,
      "amount:0": args.amountPaid,
      "hoursAdded:0": args.hours,
      "payMethod:0": args.payMethod,
      "discountPercent:0": args.discountPercent,
      "startDate:0": args.startDate,
      "endDate:0": args.endDate,
    }));
    return { ok: result.ok, message: result.message || (result.ok ? "报名已办理。" : "没有办理报名。") };
  }
  if (name === "record_payment") {
    const cents = Math.round(Number(args.amount) * 100);
    await prisma.$transaction((tx) => recordPayment(tx, {
      organizationId: actor.organizationId,
      actorId: actor.id,
      actorName: actor.name,
      enrollmentId: String(args.enrollmentId),
      amountCents: cents,
      method: String(args.method) as "CASH",
      paidAt: new Date(),
      reason: String(args.reason || ""),
      kind: args.kind === "refund" ? "refund" : "collect",
    }));
    return { ok: true as const, message: args.kind === "refund" ? "退费已记录。" : "收款已记录。" };
  }
  if (name === "add_waitlist") {
    const result = await joinClassWaitlist(String(args.classGroupId), form({ studentId: args.studentId }));
    return { ok: result.ok, message: result.message || "没有加入排队。" };
  }
  if (name === "add_follow_up") {
    const result = await recordRenewalFollowUp(String(args.studentId), String(args.courseId), form({ outcome: args.outcome, note: args.note, nextContactOn: args.nextContactOn }));
    return { ok: result.ok, message: result.message || "没有记录跟进。" };
  }
  if (name === "update_student") {
    const result = await updateStudent(String(args.studentId), form(args));
    return { ok: result.ok, message: actionText(result) };
  }
  if (name === "set_student_status") {
    const result = await setStudentStatus(String(args.studentId), args.status === "INACTIVE" ? "INACTIVE" : "ACTIVE");
    return { ok: result.ok, message: actionText(result) || (args.status === "INACTIVE" ? "学生已停用，历史记录仍保留。" : "学生已恢复在读。") };
  }
  if (name === "stop_enrollment") {
    const result = await deactivateStudent(String(args.studentId), String(args.courseId), String(args.reason));
    return { ok: result.ok, message: actionText(result) };
  }
  if (name === "set_teacher_status") {
    const result = await setTeacherStatus(String(args.teacherId), args.status === "INACTIVE" ? "INACTIVE" : "ACTIVE");
    return { ok: result.ok, message: actionText(result) || "教师状态已更新。" };
  }
  if (name === "issue_teacher_invite") {
    const result = await issueTeacherInvite(String(args.teacherId));
    return { ok: result.ok, message: result.ok && result.code ? `已生成教师邀请码：${result.code}` : result.message || "没有生成邀请码。" };
  }
  if (name === "update_class_group") {
    const result = await updateClassGroup(form({
      id: args.classGroupId,
      name: args.name,
      teacherId: args.teacherId,
      capacity: args.capacity,
      acknowledgeCapacityShrink: "1",
    }));
    return { ok: result.ok, message: actionText(result) || result.message };
  }
  if (name === "set_course_status") {
    const result = args.status === "ARCHIVED" ? await archiveCourse(String(args.courseId)) : await restoreCourse(String(args.courseId));
    return { ok: result.ok, message: actionText(result) || (args.status === "ARCHIVED" ? "课程已归档。" : "课程已恢复。") };
  }
  if (name === "set_class_status") {
    const result = args.status === "ARCHIVED" ? await archiveClassGroup(String(args.classGroupId)) : await restoreClassGroup(String(args.classGroupId));
    return { ok: result.ok, message: actionText(result) || (args.status === "ARCHIVED" ? "班级已归档。" : "班级已恢复。") };
  }
  if (name === "change_lesson_classroom") {
    const result = await changeLessonClassroom(String(args.lessonId), form({ classroomId: args.classroomId, acknowledgeConflict: "1" }));
    return { ok: result.ok, message: actionText(result) };
  }
  if (name === "change_lesson_teacher") {
    const result = await updateLessonTeacher(String(args.lessonId), form({ teacherId: args.teacherId, acknowledgeConflict: "1" }));
    return { ok: result.ok, message: actionText(result) };
  }
  if (name === "cancel_lesson") {
    const result = await cancelLesson(String(args.lessonId));
    return { ok: result.ok, message: actionText(result) };
  }
  if (name === "return_report") {
    const result = await returnReport(String(args.reportId), form({ revisionNote: args.reason }));
    return { ok: result.ok, message: actionText(result) || "报告已退回。" };
  }
  if (name === "admit_waitlist") {
    const result = await admitWaitlist(String(args.waitlistId));
    return { ok: result.ok, message: result.message || "没有转入班级。" };
  }
  if (name === "update_organization") return executeOrg(actor, String(args.name));
  if (name === "add_lesson_student") return executeAddStudent(actor, args);
  return { ok: false as const, message: "不能通过小星助教执行这个操作。" };
}

async function executeRecurring(actor: Actor, args: Record<string, string | number>) {
  const classGroup = await ownClass(actor, String(args.classGroupId));
  const room = await prisma.classroom.findFirst({ where: { id: String(args.classroomId), organizationId: actor.organizationId, available: true }, select: { id: true, name: true } });
  if (!classGroup || classGroup.teacher.status !== "ACTIVE" || !room) return { ok: false as const, message: "班级或教室已经变化，没有排课。" };
  const enrolled = await prisma.enrollment.findMany({
    where: { organizationId: actor.organizationId, classGroupId: classGroup.id, student: { status: "ACTIVE" } },
    select: { studentId: true },
    distinct: ["studentId"],
  });
  if (actor.area === "owner") {
    const data = form({ classGroupId: classGroup.id, startDate: args.startDate, endDate: args.endDate, startTime: args.startTime, endTime: args.endTime, classroomId: room.id, skipWeekends: args.skipWeekends === 1 ? "1" : "0", acknowledgeCapacity: "1" });
    for (const day of String(args.weekdays).split(",")) data.append("weekdays", day);
    for (const row of enrolled) data.append("studentIds", row.studentId);
    const result = await createRecurringLessons(data);
    return { ok: result.ok, message: result.message || (result.ok ? `已生成 ${result.created} 节课。` : "没有排课。") };
  }
  const dates = recurringDates(String(args.startDate), String(args.endDate), String(args.weekdays).split(",").map(Number), args.skipWeekends === 1);
  if (dates.truncated || dates.dates.length === 0) return { ok: false as const, message: "这个日期范围内没有可排的日期。" };
  const slots = dates.dates.flatMap((date) => {
    const startAt = parseShanghaiDateTime(`${date}T${args.startTime}`);
    const endAt = parseShanghaiDateTime(`${date}T${args.endTime}`);
    return startAt && endAt ? [{ startAt, endAt }] : [];
  });
  const studentIds = enrolled.map((row) => row.studentId);
  const existing = slots.length > 0 ? await lessonsInWindow(actor.organizationId, slots[0].startAt, slots[slots.length - 1].endAt, studentIds) : [];
  const open = slots.filter((slot) => findScheduleConflicts({ teacherId: classGroup.teacherId, classGroupId: classGroup.id, location: room.name, classroomId: room.id, studentIds, startAt: slot.startAt, endAt: slot.endAt }, existing).length === 0);
  if (open.length === 0) return { ok: true as const, message: "这些日期都有冲突，没有新课写入。" };
  await prisma.$transaction(async (tx) => {
    const created = await tx.lessonSession.createManyAndReturn({
      data: open.map((slot) => ({
        organizationId: actor.organizationId,
        classGroupId: classGroup.id,
        courseId: classGroup.courseId,
        teacherId: classGroup.teacherId,
        title: `${classGroup.course.name} · ${classGroup.name}`,
        startAt: slot.startAt,
        endAt: slot.endAt,
        location: room.name,
        classroomId: room.id,
        createdById: actor.id,
      })),
      select: { id: true },
    });
    if (studentIds.length > 0) {
      await tx.lessonStudent.createMany({
        data: created.flatMap((lesson) => studentIds.map((studentId) => ({ organizationId: actor.organizationId, lessonSessionId: lesson.id, studentId, seat: "ENROLLED" as const, lastAction: "加入课次" }))),
      });
    }
  });
  return { ok: true as const, message: `已生成 ${open.length} 节课，跳过 ${slots.length - open.length} 个冲突日期。` };
}

async function executeAttendance(actor: Actor, args: Record<string, string | number>) {
  const fields = toAttendanceFields(String(args.status));
  if (!fields || fields.status === "NOT_MARKED") return { ok: false as const, message: "考勤状态无效。" };
  const lesson = await prisma.lessonSession.findFirst({
    where: { id: String(args.lessonId), organizationId: actor.organizationId, status: { not: "CANCELLED" }, ...(actor.area === "teacher" ? { teacherId: actor.teacherId ?? "__none__" } : {}) },
    select: { id: true, courseId: true, course: { select: { name: true, billingType: true } }, students: { where: { studentId: String(args.studentId) }, select: { id: true, studentId: true, seat: true, student: { select: { name: true, status: true } } } } },
  });
  const seat = lesson?.students[0];
  if (!lesson || !seat || seat.student.status !== "ACTIVE") return { ok: false as const, message: "没有找到可以点名的学生。" };
  const charged = new Set(["PRESENT", "LATE", "ABSENT"]);
  await prisma.$transaction((tx) => syncAttendanceCharge(tx, {
    organizationId: actor.organizationId,
    lessonStudentId: seat.id,
    studentId: seat.studentId,
    studentName: seat.student.name,
    courseId: lesson.courseId,
    courseName: lesson.course.name,
    billingType: lesson.course.billingType,
    seat: seat.seat,
    shouldCharge: charged.has(fields.status),
    attendanceStatus: fields.status,
    attendanceNote: String(args.note || "") || null,
    leaveKind: fields.leaveKind,
  }));
  return { ok: true as const, message: `已把${seat.student.name}记为${attendanceDisplayLabel(fields.status, fields.leaveKind)}。` };
}

async function executeReschedule(actor: Actor, args: Record<string, string | number>) {
  const startAt = new Date(String(args.startAt));
  const endAt = new Date(String(args.endAt));
  const lesson = await prisma.lessonSession.findFirst({
    where: { id: String(args.lessonId), organizationId: actor.organizationId, status: { not: "CANCELLED" }, ...(actor.area === "teacher" ? { teacherId: actor.teacherId ?? "__none__" } : {}) },
    select: { id: true, title: true, startAt: true, endAt: true, students: { select: { studentId: true } } },
  });
  if (!lesson || Number.isNaN(startAt.getTime()) || endAt <= startAt) return { ok: false as const, message: "课次或时间已经变化，没有修改。" };
  if (actor.area === "teacher") {
    if (!actor.teacherId) return { ok: false as const, message: "当前账号不能提交调课。" };
    return submitLessonRequest({ organizationId: actor.organizationId, userId: actor.id, teacherId: actor.teacherId, lessonId: lesson.id, kind: "RESCHEDULE", startAt, endAt, note: "由小星助教提交" });
  }
  const from = formatDateTime(lesson.startAt);
  await prisma.$transaction(async (tx) => {
    const updated = await tx.lessonSession.updateMany({ where: { id: lesson.id, organizationId: actor.organizationId }, data: { startAt, endAt } });
    if (updated.count !== 1) throw new CourseHourError("课次已经变化，没有修改。");
    await writeAudit(tx, { organizationId: actor.organizationId, actorId: actor.id, action: "LESSON_RESCHEDULED", targetType: "LessonSession", targetId: lesson.id, detail: `${actor.name}把「${lesson.title ?? "课次"}」从 ${from} 改到 ${formatDateTime(startAt)}` });
  });
  await cancelPendingLessonRequests(actor.organizationId, lesson.id, "负责人已直接修改时间");
  if (lesson.startAt.getTime() !== startAt.getTime() || lesson.endAt.getTime() !== endAt.getTime()) {
    await notifyLessonChange({
      organizationId: actor.organizationId,
      studentIds: lesson.students.map((row) => row.studentId),
      title: lesson.title,
      when: startAt,
      change: `上课时间改为 ${formatDateTime(startAt)}–${formatClock(endAt)}`,
      dedupeKey: `lesson:${lesson.id}:time:${startAt.toISOString()}:${endAt.toISOString()}`,
    });
  }
  return { ok: true as const, message: "上课时间已修改。" };
}

async function teacherMakeup(actor: Actor, sourceId: string, targetLessonId: string) {
  const source = await prisma.lessonStudent.findFirst({
    where: { id: sourceId, organizationId: actor.organizationId, attendanceStatus: "LEAVE", lessonSession: { teacherId: actor.teacherId ?? "__none__" } },
    select: { id: true, studentId: true, student: { select: { name: true, status: true } }, lessonSession: { select: { id: true, courseId: true, startAt: true, status: true } } },
  });
  if (!source || source.lessonSession.status === "CANCELLED" || source.student.status !== "ACTIVE") return { ok: false, message: "只能给自己课次上的请假记录安排补课。" };
  const already = await prisma.lessonStudent.findFirst({ where: { organizationId: actor.organizationId, makeupSourceId: source.id }, select: { id: true } });
  if (already) return { ok: false, message: "这次请假已经安排过补课。" };
  const target = await prisma.lessonSession.findFirst({
    where: { id: targetLessonId, organizationId: actor.organizationId, teacherId: actor.teacherId ?? "__none__", courseId: source.lessonSession.courseId, status: { not: "CANCELLED" } },
    select: { id: true, title: true, startAt: true, students: { where: { studentId: source.studentId }, select: { id: true } } },
  });
  if (!target || target.id === source.lessonSession.id || target.students.length > 0) return { ok: false, message: "只能补到你自己讲授的、同一门课、且这名学生还不在名单里的课次。" };
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.lessonStudent.create({
      data: { organizationId: actor.organizationId, lessonSessionId: target.id, studentId: source.studentId, seat: "GUEST", makeupSourceId: source.id, lastAction: "安排补课" },
      select: { id: true },
    });
    await writeAudit(tx, { organizationId: actor.organizationId, actorId: actor.id, action: "MAKEUP_SCHEDULED", targetType: "LessonStudent", targetId: row.id, detail: `${actor.name}把${source.student.name}加入「${target.title ?? "课次"}」补课` });
    return row.id;
  });
  await notifyMakeupArranged({
    organizationId: actor.organizationId,
    studentId: source.studentId,
    targetTitle: target.title,
    targetStart: target.startAt,
    sourceStart: source.lessonSession.startAt,
    lessonStudentId: created,
  });
  return { ok: true, message: `已把${source.student.name}加入「${target.title ?? "课次"}」。` };
}

async function executeGenerate(actor: Actor, args: Record<string, string | number>) {
  const lesson = await prisma.lessonSession.findFirst({
    where: { id: String(args.lessonId), organizationId: actor.organizationId, status: { not: "CANCELLED" }, ...(actor.area === "teacher" ? { teacherId: actor.teacherId ?? "__none__" } : {}) },
    include: { teachingRecord: true, students: { select: { studentId: true, student: { select: { name: true } } } }, course: { select: { id: true, name: true } } },
  });
  if (!lesson || lesson.students.length === 0) return { ok: false as const, message: "这节课没有可以生成报告的学生。" };
  let record = lesson.teachingRecord;
  if (!record) {
    const lessonContent = String(args.lessonContent || "").trim();
    if (!lessonContent) return { ok: false as const, message: "还没有教学记录，没有生成。" };
    record = await prisma.teachingRecord.create({
      data: {
        organizationId: actor.organizationId,
        lessonSessionId: lesson.id,
        teacherId: lesson.teacherId,
        lessonContent,
        studentPerformance: String(args.studentPerformance || ""),
        difficulties: String(args.difficulties || ""),
        homework: String(args.homework || "") || null,
      },
    });
    await notifyHomeworkSaved({
      organizationId: actor.organizationId,
      lessonId: lesson.id,
      title: lesson.title,
      when: lesson.startAt,
      studentIds: lesson.students.map((row) => row.studentId),
      previous: null,
      homework: record.homework ?? "",
    });
  }
  const organization = await prisma.organization.findUnique({ where: { id: actor.organizationId }, select: { reportLanguage: true, aiUseRecentSummaries: true, aiTeacherMustConfirm: true } });
  const settings = readOrgReportSettings(organization);
  const existing = await prisma.teachingReport.findMany({ where: { organizationId: actor.organizationId, lessonSessionId: lesson.id }, select: { id: true, studentId: true, status: true } });
  const byStudent = new Map(existing.map((row) => [row.studentId, row]));
  const names = lesson.students.map((row) => row.student.name);
  let created = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of lesson.students) {
    const current = byStudent.get(row.studentId);
    if (current && (current.status === "PUBLISHED" || current.status === "CONFIRMED")) {
      skipped += 1;
      continue;
    }
    try {
      const history = await recentSummariesForPrompt(prisma, { enabled: settings.aiUseRecentSummaries, organizationId: actor.organizationId, studentId: row.studentId, courseId: lesson.courseId, excludeLessonId: lesson.id });
      await generateAndStoreDraft(prisma, { organizationId: actor.organizationId, lessonSessionId: lesson.id, studentId: row.studentId, teachingRecordId: record.id, existingId: current?.id ?? null }, () => generateLessonAnalysis({
        language: settings.reportLanguage,
        useRecentSummaries: settings.aiUseRecentSummaries,
        history,
        lessonContent: record.lessonContent,
        studentPerformance: record.studentPerformance,
        difficulties: record.difficulties,
        homework: record.homework ?? "",
        studentNames: names,
      }));
      created += 1;
    } catch {
      failed += 1;
    }
  }
  return { ok: failed === 0, message: `已生成 ${created} 份草稿，跳过 ${skipped} 份已确认或已发布的报告${failed > 0 ? `，${failed} 份没有生成成功` : ""}。` };
}
