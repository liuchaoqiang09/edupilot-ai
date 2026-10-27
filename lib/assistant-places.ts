import type OpenAI from "openai";
import { arrearsCents, decimalCents } from "@/lib/enrollment-money";
import { billingUsageLabel, needsBillingFollowUp } from "@/lib/billing-list";
import { calendarDateKey, periodValidity } from "@/lib/course-hours";
import { classIsFull, distinctEnrolled } from "@/lib/class-occupancy";
import { dayRange, formatDateTime, shanghaiDateKey, shiftDate } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";

type Actor = { organizationId: string; area: "owner" | "teacher"; teacherId: string | null };

const ownerPlaces = [
  "记录报名", "调整课时", "收款流水", "续费跟进", "新增学生", "导入学生", "学生档案",
  "新增教师", "教师档案", "创建课程", "创建班级", "班级排队", "添加教室",
  "创建课次", "周期排课", "课次详情", "记录考勤", "教学报告", "出勤记录",
  "待续费", "待填记录", "待确认报告", "试听跟进", "满班排队",
  "操作记录", "基础统计", "机构设置", "工作台", "账号",
] as const;

const teacherPlaces = ["记录考勤", "教学记录", "教学报告", "我的学生", "我的课表", "课次详情"] as const;

export function openExactTool(area: "owner" | "teacher"): OpenAI.Chat.ChatCompletionTool {
  const places = area === "owner" ? ownerPlaces : teacherPlaces;
  return {
    type: "function",
    function: {
      name: "open_exact",
      description: "只在用户要查看或打开某个功能、且没有给出要写入的学生、课程、金额、节数或时间时使用。用户已经说出要办理的内容时，不要调用本工具，先查询编号再调用 execute_ 工具。target 填用户提到的姓名或名称，没有就空字符串。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          place: { type: "string", enum: [...places], description: "最具体的位置" },
          target: { type: "string", description: "用户话里的姓名或名称，没有就空字符串" },
        },
        required: ["place", "target"],
      },
    },
  };
}

function stamp(href: string) {
  const join = href.includes("?") ? "&" : "?";
  return `${href}${join}open=${Date.now()}`;
}

async function people(actor: Actor) {
  const allowed = actor.area === "teacher" && actor.teacherId
    ? new Set((await prisma.lessonStudent.findMany({
        where: { organizationId: actor.organizationId, lessonSession: { teacherId: actor.teacherId } },
        select: { studentId: true },
        distinct: ["studentId"],
      })).map((row) => row.studentId))
    : null;
  const students = await prisma.student.findMany({
    where: { organizationId: actor.organizationId, status: "ACTIVE", ...(allowed ? { id: { in: [...allowed] } } : {}) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 300,
  });
  return students;
}

function named<T extends { name: string }>(rows: T[], target: string) {
  const text = target.trim();
  if (!text) return null;
  const hits = rows.filter((row) => text.includes(row.name) || row.name.includes(text));
  hits.sort((left, right) => right.name.length - left.name.length);
  return hits[0] ?? null;
}

async function studentCourse(actor: Actor, studentId: string, target: string) {
  const rows = await prisma.enrollment.findMany({
    where: { organizationId: actor.organizationId, studentId, ...(actor.area === "teacher" && actor.teacherId ? { classGroup: { teacherId: actor.teacherId } } : {}) },
    select: { courseId: true, course: { select: { name: true, billingType: true } } },
    orderBy: { createdAt: "desc" },
    take: 12,
  });
  const match = rows.find((row) => target.includes(row.course.name)) ?? rows.find((row) => row.course.billingType === "PER_LESSON") ?? rows[0];
  return match ? { courseId: match.courseId, courseName: match.course.name } : null;
}

async function lessonFor(actor: Actor, target: string) {
  const student = named(await people(actor), target);
  const lesson = await prisma.lessonSession.findFirst({
    where: {
      organizationId: actor.organizationId,
      status: { not: "CANCELLED" },
      ...(actor.area === "teacher" && actor.teacherId ? { teacherId: actor.teacherId } : {}),
      ...(student
        ? { students: { some: { studentId: student.id } } }
        : target.trim()
          ? { OR: [{ title: { contains: target.trim() } }, { course: { name: { contains: target.trim() } } }, { classGroup: { name: { contains: target.trim() } } }] }
          : { startAt: { gte: new Date(`${shanghaiDateKey()}T00:00:00+08:00`) } }),
    },
    select: { id: true, title: true, startAt: true },
    orderBy: target.trim() && !student ? { startAt: "desc" } : { startAt: "asc" },
  });
  return lesson;
}

export async function resolveExactPlace(actor: Actor, place: string, target: string) {
  const allowed: readonly string[] = actor.area === "owner" ? ownerPlaces : teacherPlaces;
  if (!allowed.includes(place)) {
    return { ok: false as const, message: "这个位置不在当前账号能打开的范围内。请改选一个具体位置。" };
  }
  const text = target.trim();
  const students = await people(actor);
  const student = named(students, text);

  if (actor.area === "teacher") {
    if (place === "我的学生") {
      return { ok: true as const, href: student ? `/teacher/students#student-${student.id}` : "/teacher/students", reply: student ? `已定位到${student.name}。` : "我的学生已打开。" };
    }
    if (place === "教学报告") {
      const report = student
        ? await prisma.teachingReport.findFirst({
            where: { organizationId: actor.organizationId, studentId: student.id, ...(actor.teacherId ? { lessonSession: { teacherId: actor.teacherId } } : {}) },
            select: { id: true, lessonSessionId: true },
            orderBy: { updatedAt: "desc" },
          })
        : null;
      if (report) return { ok: true as const, href: `/teacher/records?lesson=${report.lessonSessionId}&report=${report.id}`, reply: `已打开${student?.name ?? ""}的教学报告。` };
      return { ok: true as const, href: "/teacher/reports", reply: "教学报告已打开。" };
    }
    if (place === "教学记录") {
      const lesson = await lessonFor(actor, text);
      if (lesson) return { ok: true as const, href: `/teacher/records?lesson=${lesson.id}`, reply: `已打开${lesson.title ?? "这节课"}的教学记录。` };
      return { ok: true as const, href: "/teacher/records", reply: "教学记录已打开。" };
    }
    const lesson = await lessonFor(actor, text);
    if (lesson) {
      const date = shanghaiDateKey(lesson.startAt);
      return { ok: true as const, href: `/teacher/schedule?view=day&date=${date}&lesson=${lesson.id}`, reply: `已打开${lesson.title ?? "这节课"}的考勤。` };
    }
    return { ok: true as const, href: "/teacher/schedule", reply: "课表已打开。" };
  }

  if (place === "记录报名") {
    if (student) {
      const course = await studentCourse(actor, student.id, text);
      const query = new URLSearchParams({ form: "enroll", who: student.id });
      if (course) query.set("focus", `${student.id}:${course.courseId}`);
      return { ok: true as const, href: stamp(`/owner/billing?${query}`), reply: `已打开${student.name}的报名表。` };
    }
    return { ok: true as const, href: stamp("/owner/billing?form=enroll"), reply: "报名表已打开。" };
  }
  if (place === "调整课时" || place === "收款流水" || place === "续费跟进") {
    if (!student) {
      return { ok: true as const, href: place === "续费跟进" ? "/owner/billing?pin=renewal" : "/owner/billing", reply: place === "续费跟进" ? "待续费名单已打开。" : "报名与课时已打开。请点对应学生那一行。" };
    }
    const course = await studentCourse(actor, student.id, text);
    const focus = course ? `${student.id}:${course.courseId}` : student.id;
    const panel = place === "调整课时" ? "adjust" : place === "收款流水" ? "pay" : "follow";
    return { ok: true as const, href: stamp(`/owner/billing?panel=${panel}&who=${student.id}&focus=${encodeURIComponent(focus)}`), reply: `已打开${student.name}${course ? ` · ${course.courseName}` : ""}的${place}。` };
  }
  if (place === "新增学生") return { ok: true as const, href: stamp("/owner/students?create=1"), reply: "新增学生已打开。" };
  if (place === "导入学生") return { ok: true as const, href: stamp("/owner/students?form=import"), reply: "批量导入学生已打开。" };
  if (place === "学生档案") {
    if (!student) return { ok: true as const, href: "/owner/students", reply: "学生管理已打开。" };
    return { ok: true as const, href: `/owner/students?student=${student.id}`, reply: `已打开${student.name}的档案。` };
  }
  if (place === "新增教师") return { ok: true as const, href: stamp("/owner/teachers?form=create"), reply: "新增教师已打开。" };
  if (place === "教师档案") {
    const teachers = await prisma.teacher.findMany({ where: { organizationId: actor.organizationId, status: "ACTIVE" }, select: { id: true, name: true }, take: 200 });
    const teacher = named(teachers, text);
    if (!teacher) return { ok: true as const, href: "/owner/teachers", reply: "教师管理已打开。" };
    return { ok: true as const, href: `/owner/teachers?teacher=${teacher.id}`, reply: `已打开${teacher.name}的档案。` };
  }
  if (place === "创建课程") return { ok: true as const, href: stamp("/owner/courses?form=course"), reply: "创建课程已打开。" };
  if (place === "创建班级") return { ok: true as const, href: stamp("/owner/courses?form=class"), reply: "创建班级已打开。" };
  if (place === "班级排队" || place === "满班排队") {
    const classes = await prisma.classGroup.findMany({ where: { organizationId: actor.organizationId, status: "ACTIVE" }, select: { id: true, name: true }, take: 200 });
    const classGroup = named(classes, text);
    if (!classGroup) return { ok: true as const, href: "/owner/todos?group=waitlist", reply: "满班排队已打开。" };
    return { ok: true as const, href: `/owner/courses?class=${classGroup.id}`, reply: `已打开${classGroup.name}的排队。` };
  }
  if (place === "添加教室") return { ok: true as const, href: stamp("/owner/rooms?form=create"), reply: "添加教室已打开。" };
  if (place === "创建课次") return { ok: true as const, href: stamp("/owner/schedule?form=lesson"), reply: "创建课次已打开。" };
  if (place === "周期排课") return { ok: true as const, href: stamp("/owner/schedule?form=recurring"), reply: "周期排课已打开。" };
  if (place === "课次详情" || place === "记录考勤") {
    const lesson = await lessonFor(actor, text);
    if (!lesson) return { ok: true as const, href: place === "记录考勤" ? "/owner/attendance?range=last7days" : "/owner/schedule", reply: place === "记录考勤" ? "出勤记录已打开。" : "课表已打开。" };
    const date = shanghaiDateKey(lesson.startAt);
    return { ok: true as const, href: `/owner/schedule?view=day&date=${date}&lesson=${lesson.id}`, reply: `已打开${lesson.title ?? "这节课"}。` };
  }
  if (place === "教学报告" || place === "待确认报告") {
    const report = await prisma.teachingReport.findFirst({
      where: {
        organizationId: actor.organizationId,
        ...(student ? { studentId: student.id } : {}),
        ...(place === "待确认报告" ? { status: { in: ["DRAFT", "CONFIRMED", "RETURNED"] } } : {}),
      },
      select: { id: true, student: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
    });
    if (!report) return { ok: true as const, href: "/owner/reports", reply: "教学报告已打开。" };
    const query = new URLSearchParams({ all: "1", report: report.id });
    if (student) query.set("q", student.name);
    if (place === "待确认报告") query.set("status", "待确认");
    return { ok: true as const, href: `/owner/reports?${query}`, reply: `已打开${report.student.name}的教学报告。` };
  }
  if (place === "出勤记录") {
    const query = new URLSearchParams({ range: "last7days" });
    if (student) query.set("q", student.name);
    return { ok: true as const, href: `/owner/attendance?${query}`, reply: student ? `已定位${student.name}的出勤。` : "出勤记录已打开。" };
  }
  if (place === "待续费") return { ok: true as const, href: "/owner/todos?group=renewal", reply: "待续费已打开。" };
  if (place === "待填记录") return { ok: true as const, href: "/owner/todos?group=records", reply: "待填教学记录已打开。" };
  if (place === "试听跟进") return { ok: true as const, href: "/owner/todos?group=trials", reply: "试听跟进已打开。" };
  if (place === "操作记录") return { ok: true as const, href: "/owner/audit", reply: "操作记录已打开。" };
  if (place === "基础统计") return { ok: true as const, href: "/owner/stats", reply: "基础统计已打开。" };
  if (place === "机构设置") return { ok: true as const, href: "/owner/settings", reply: "机构设置已打开。" };
  if (place === "账号") return { ok: true as const, href: "/owner/account", reply: "账号管理已打开。" };
  return { ok: true as const, href: "/owner", reply: "工作台已打开。" };
}

const screens = ["未报名", "欠费", "已过期", "即将过期", "课时不足", "无课时", "待续费"] as const;
const queues = ["在读学生", "已停用学生", "在职教师", "已停用教师", "待填记录", "待确认报告", "已发布报告", "试听跟进", "满班排队", "请假", "缺勤", "迟到", "未点名", "今日课表", "停用教室", "已取消课次", "没绑家长"] as const;
export type StudentScreen = (typeof screens)[number];
export type WorkQueue = (typeof queues)[number];

export function screenIntent(text: string): StudentScreen | null {
  const compact = text.replace(/\s+/g, "");
  if (!compact || compact.startsWith("系统已执行")) return null;
  if (/交\d+|\d+元|现金|微信|支付宝/.test(compact)) return null;
  if (/给.{1,8}(报|加|调)/.test(compact) && !/没有报名|没报名|未报名|谁|哪些|名单|定位|筛选/.test(compact)) return null;
  if (/没报名|未报名|没有报名|还没报名|没报过|未报班|没有报班/.test(compact)) return "未报名";
  if (/欠费|没交齐|没交完|还欠/.test(compact)) return "欠费";
  if (/课时不够|课时不足|课不够/.test(compact)) return "课时不足";
  if (/没课时|无课时|课时用完|课时没了/.test(compact)) return "无课时";
  if (/快过期|即将过期|马上到期|快到期/.test(compact)) return "即将过期";
  if (/已过期|过期了|课程过期/.test(compact)) return "已过期";
  if (/待续费|该续费|要续费|该续课/.test(compact)) return "待续费";
  return null;
}

export function screenStudentsTool(): OpenAI.Chat.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: "screen_students",
      description: "按情况筛出学生、教师、课次、报告或教室，并打开对应名单。用户要找一类人时必须调用，不要说系统没有这个筛选。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { situation: { type: "string", enum: [...screens, ...queues] } },
        required: ["situation"],
      },
    },
  };
}

const screenHref: Record<StudentScreen, string> = {
  未报名: "/owner/billing?status=未报名",
  欠费: "/owner/billing?status=欠费",
  已过期: "/owner/billing?status=已过期",
  即将过期: "/owner/billing?status=即将过期",
  课时不足: "/owner/billing?status=即将过期",
  无课时: "/owner/billing?status=已过期",
  待续费: "/owner/billing?status=待续费",
};

export async function locateStudents(actor: Actor, situation: string) {
  if (actor.area !== "owner") return { ok: false as const, message: "教师端不能打开全机构的报名和欠费名单。" };
  if (!screens.includes(situation as StudentScreen)) return { ok: false as const, message: "请说明要找没报名、欠费、过期、课时不足还是待续费的学生。" };
  const screen = situation as StudentScreen;
  const today = shanghaiDateKey();
  if (screen === "未报名") {
    const rows = await prisma.student.findMany({
      where: { organizationId: actor.organizationId, status: "ACTIVE", enrollments: { none: {} } },
      select: { name: true },
      orderBy: { name: "asc" },
      take: 40,
    });
    const names = rows.map((row) => row.name);
    return { ok: true as const, href: screenHref[screen], reply: names.length === 0 ? "没有未报名的在读学生。名单已打开。" : `没有报名的有 ${names.length} 人：${names.join("、")}。名单已打开。` };
  }
  const [students, enrollments, balances] = await Promise.all([
    prisma.student.findMany({ where: { organizationId: actor.organizationId, status: "ACTIVE" }, select: { id: true, name: true } }),
    prisma.enrollment.findMany({
      where: { organizationId: actor.organizationId, student: { status: "ACTIVE" } },
      select: { studentId: true, courseId: true, amountDue: true, discountPercent: true, startDate: true, endDate: true, course: { select: { billingType: true } }, payments: { where: { voidedAt: null }, select: { amount: true } } },
    }),
    prisma.courseHourBalance.findMany({ where: { organizationId: actor.organizationId }, select: { studentId: true, courseId: true, remainingHours: true } }),
  ]);
  const hours = new Map(balances.map((row) => [`${row.studentId}:${row.courseId}`, row.remainingHours]));
  const windows = new Map<string, { start: string; end: string }[]>();
  for (const row of enrollments) {
    if (row.course.billingType !== "PER_PERIOD" || !row.startDate || !row.endDate) continue;
    const key = `${row.studentId}:${row.courseId}`;
    windows.set(key, [...(windows.get(key) ?? []), { start: calendarDateKey(row.startDate), end: calendarDateKey(row.endDate) }]);
  }
  const names = new Set<string>();
  const studentName = new Map(students.map((row) => [row.id, row.name]));
  const seen = new Set<string>();
  for (const row of enrollments) {
    const key = `${row.studentId}:${row.courseId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const due = decimalCents(row.amountDue);
    const net = row.payments.reduce((sum, payment) => sum + decimalCents(payment.amount), 0);
    const discount = row.discountPercent == null ? null : Number(row.discountPercent);
    const period = row.course.billingType === "PER_PERIOD" ? periodValidity(windows.get(key) ?? [], today) : null;
    const remaining = row.course.billingType === "PER_LESSON" ? hours.get(key) ?? 0 : null;
    const usage = { enrolled: true, billingType: row.course.billingType, periodStatus: period?.status ?? null, remainingHours: remaining, validUntil: period && period.end !== "—" ? period.end : null };
    const label = billingUsageLabel(usage, today);
    const hit = screen === "欠费" ? arrearsCents(due, net, discount) > 0
      : screen === "待续费" ? needsBillingFollowUp(usage, today)
        : screen === "已过期" ? label === "已过期"
          : screen === "即将过期" ? label === "即将过期"
            : screen === "课时不足" ? label === "课时不足"
              : label === "无课时";
    if (hit) names.add(studentName.get(row.studentId) ?? "学生");
    if (names.size >= 40) break;
  }
  const listed = [...names];
  return { ok: true as const, href: screenHref[screen], reply: listed.length === 0 ? `没有符合「${screen}」的学生。对应名单已打开。` : `${screen}的有 ${listed.length} 人：${listed.join("、")}。名单已打开。` };
}

export function queueIntent(text: string): WorkQueue | null {
  const compact = text.replace(/\s+/g, "");
  if (!compact || compact.startsWith("系统已执行") || screenIntent(text)) return null;
  if (/交\d+|\d+元|现金|微信|支付宝/.test(compact)) return null;
  if (/已停用的?学生|停用了的学生|学生已停用|停用学生名单/.test(compact)) return "已停用学生";
  if (/多少(名|个)?学生|几个学生|学生(人数|数量)|多少学员|几个学员|在读学生|在读学员|正在读的学生/.test(compact)) return "在读学生";
  if (/多少(名|个|位)?(教师|老师)|几个(教师|老师)/.test(compact)) return "在职教师";
  if (/在职教师|在职老师/.test(compact)) return "在职教师";
  if (/已停用的?(教师|老师)|停用的?(教师|老师)|离职(教师|老师)/.test(compact)) return "已停用教师";
  if (/待填(写)?(的)?(教学)?记录|没写(教学)?记录|还没填记录|教学记录没填/.test(compact)) return "待填记录";
  if (/待确认(的)?报告|没确认的报告|报告待确认|草稿报告/.test(compact)) return "待确认报告";
  if (/已发布(的)?报告/.test(compact)) return "已发布报告";
  if (/试听(跟进|的人|学生|名单)|未转化|谁在试听/.test(compact) && !/转报名|转为报名/.test(compact)) return "试听跟进";
  if (/满班|在排队|等位|排队(的人|名单|学生)/.test(compact) && !/加入排队|转入班级|把.+转入/.test(compact)) return "满班排队";
  if (/谁请假|请假的(人|学生)|请了假/.test(compact) && !/安排补课|补课/.test(compact)) return "请假";
  if (/谁缺勤|缺勤的(人|学生)|没来的(人|学生)/.test(compact)) return "缺勤";
  if (/谁迟到|迟到的(人|学生)/.test(compact)) return "迟到";
  if (/没点名|未点名|还没考勤|未标记出勤/.test(compact)) return "未点名";
  if (/多少(节)?课|几节课|今天(的|有哪些|要上的|有(什么|哪些))?课|今日课表/.test(compact) && !/排课|调课|取消|点名/.test(compact)) return "今日课表";
  if (/停用的教室|已停用教室|不可用教室|哪些教室停用/.test(compact)) return "停用教室";
  if (/已取消的(课|课次)|取消了的课次/.test(compact)) return "已取消课次";
  if (/没绑家长|没有家长|未绑定家长|还没关联家长/.test(compact) && !/^(给|把|为)/.test(compact)) return "没绑家长";
  return null;
}

function opened(label: string, names: string[], href: string, unit = "人") {
  const unique = [...new Set(names)].slice(0, 40);
  const reply = unique.length === 0 ? `没有符合「${label}」的记录。对应位置已打开。` : `${label}有 ${unique.length} ${unit}：${unique.join("、")}。已打开。`;
  return { ok: true as const, href, reply };
}

export async function locateWork(actor: Actor, situation: string) {
  if ((screens as readonly string[]).includes(situation)) return locateStudents(actor, situation);
  if (!(queues as readonly string[]).includes(situation)) return { ok: false as const, message: "请说明要找的是哪一类学生、课次、报告或教室。" };
  return locateQueue(actor, situation as WorkQueue);
}

async function locateQueue(actor: Actor, queue: WorkQueue) {
  const owner = actor.area === "owner";
  const teacherId = actor.teacherId;
  if (!owner && !teacherId && queue !== "今日课表") return { ok: false as const, message: "当前账号没有教师档案，不能查这些名单。" };
  if (!owner && (queue === "在职教师" || queue === "已停用教师" || queue === "停用教室")) return { ok: false as const, message: "教师端不能打开全机构的教师和教室名单。" };
  const org = actor.organizationId;
  const lessonOwner = owner ? {} : { teacherId: teacherId ?? "__none__" };
  const today = shanghaiDateKey();
  if (queue === "在读学生" || queue === "已停用学生" || queue === "没绑家长") {
    const inactive = queue === "已停用学生";
    const rows = await prisma.student.findMany({
      where: {
        organizationId: org,
        ...(inactive ? { status: "INACTIVE" } : { status: "ACTIVE" }),
        ...(queue === "在读学生" ? { enrollments: { some: {} } } : {}),
        ...(queue === "没绑家长" ? { parentLinks: { none: {} } } : {}),
        ...(!owner && teacherId ? { OR: [{ enrollments: { some: { classGroup: { teacherId } } } }, { lessonStudents: { some: { lessonSession: { teacherId } } } }] } : {}),
      },
      select: { name: true },
      orderBy: { name: "asc" },
      take: 40,
    });
    const href = !owner ? (inactive ? "/teacher/students?status=含已停用" : "/teacher/students") : queue === "已停用学生" ? "/owner/students?status=已停用" : queue === "在读学生" ? "/owner/students?status=在读" : "/owner/students";
    return opened(queue, rows.map((row) => row.name), href);
  }
  if (queue === "在职教师" || queue === "已停用教师") {
    const rows = await prisma.teacher.findMany({
      where: { organizationId: org, status: queue === "在职教师" ? "ACTIVE" : "INACTIVE" },
      select: { name: true },
      orderBy: { name: "asc" },
      take: 40,
    });
    return opened(queue, rows.map((row) => row.name), queue === "在职教师" ? "/owner/teachers?status=在职" : "/owner/teachers?status=已停用");
  }
  if (queue === "待填记录") {
    const rows = await prisma.lessonSession.findMany({
      where: { organizationId: org, status: { not: "CANCELLED" }, endAt: { lte: new Date() }, teachingRecord: { is: null }, ...lessonOwner },
      select: { title: true, startAt: true, course: { select: { name: true } } },
      orderBy: { endAt: "desc" },
      take: 40,
    });
    return opened(queue, rows.map((row) => `${row.course.name} ${formatDateTime(row.startAt)}`), owner ? "/owner/schedule?status=待填写" : "/teacher/records", "节");
  }
  if (queue === "待确认报告" || queue === "已发布报告") {
    const pending = queue === "待确认报告";
    const rows = await prisma.teachingReport.findMany({
      where: { organizationId: org, status: pending ? { in: ["DRAFT", "CONFIRMED", "RETURNED"] } : "PUBLISHED", ...(!owner && teacherId ? { lessonSession: { teacherId } } : {}) },
      select: { student: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 40,
    });
    const href = owner ? `/owner/reports?all=1&status=${encodeURIComponent(pending ? "待确认" : "已发布")}` : "/teacher/reports";
    return opened(queue, rows.map((row) => row.student.name), href, "份");
  }
  if (queue === "试听跟进") {
    const rows = await prisma.lessonStudent.findMany({
      where: { organizationId: org, seat: "TRIAL", lessonSession: { status: { not: "CANCELLED" }, ...lessonOwner } },
      select: { student: { select: { name: true } } },
      orderBy: { lessonSession: { startAt: "desc" } },
      take: 40,
    });
    return opened(queue, rows.map((row) => row.student.name), owner ? "/owner/todos?group=trials" : "/teacher/students");
  }
  if (queue === "满班排队") {
    const classes = await prisma.classGroup.findMany({
      where: { organizationId: org, status: "ACTIVE", ...(owner ? {} : { teacherId: teacherId ?? "__none__" }) },
      select: { id: true, name: true, capacity: true },
    });
    const enrolled = distinctEnrolled(await prisma.enrollment.findMany({
      where: { organizationId: org, classGroupId: { in: classes.map((item) => item.id) }, student: { status: "ACTIVE" } },
      select: { classGroupId: true, studentId: true },
    }));
    const waits = await prisma.classWaitlist.findMany({
      where: { organizationId: org, classGroupId: { in: classes.map((item) => item.id) } },
      select: { classGroupId: true, student: { select: { name: true } } },
    });
    const full = classes.filter((item) => classIsFull(item.capacity, enrolled.get(item.id)?.size ?? 0));
    const waiting = waits.map((row) => row.student.name);
    const label = full.map((item) => item.name);
    const href = owner ? (full.length === 1 ? `/owner/courses?class=${full[0].id}` : "/owner/todos?group=waitlist") : "/teacher/students";
    return opened(queue, waiting.length > 0 ? waiting : label, href, waiting.length > 0 ? "人" : "个班");
  }
  if (queue === "请假" || queue === "缺勤" || queue === "迟到" || queue === "未点名") {
    const status = queue === "请假" ? "LEAVE" : queue === "缺勤" ? "ABSENT" : queue === "迟到" ? "LATE" : "NOT_MARKED";
    const start = dayRange(shiftDate(today, -6)).start;
    const end = dayRange(today).end;
    const rows = await prisma.lessonStudent.findMany({
      where: { organizationId: org, attendanceStatus: status, lessonSession: { startAt: { gte: start, lt: end }, status: { not: "CANCELLED" }, ...lessonOwner } },
      select: { student: { select: { name: true } } },
      take: 40,
    });
    const href = owner ? `/owner/attendance?range=last7days&status=${encodeURIComponent(queue === "未点名" ? "未标记" : queue)}` : "/teacher/schedule";
    return opened(queue, rows.map((row) => row.student.name), href);
  }
  if (queue === "今日课表") {
    const range = dayRange(today);
    const rows = await prisma.lessonSession.findMany({
      where: { organizationId: org, status: { not: "CANCELLED" }, startAt: { gte: range.start, lt: range.end }, ...lessonOwner },
      select: { title: true, startAt: true, course: { select: { name: true } } },
      orderBy: { startAt: "asc" },
      take: 40,
    });
    const href = owner ? `/owner/schedule?view=day&date=${today}` : `/teacher/schedule?view=day&date=${today}`;
    return opened(queue, rows.map((row) => `${row.course?.name || row.title} ${formatDateTime(row.startAt)}`), href, "节");
  }
  if (queue === "停用教室") {
    const rows = await prisma.classroom.findMany({
      where: { organizationId: org, available: false },
      select: { name: true },
      orderBy: { name: "asc" },
      take: 40,
    });
    return opened(queue, rows.map((row) => row.name), "/owner/rooms", "间");
  }
  const rows = await prisma.lessonSession.findMany({
    where: { organizationId: org, status: "CANCELLED", ...lessonOwner },
    select: { title: true, startAt: true, course: { select: { name: true } } },
    orderBy: { startAt: "desc" },
    take: 40,
  });
  const href = owner ? `/owner/schedule?view=day&date=${today}` : `/teacher/schedule?view=day&date=${today}`;
  return opened(queue, rows.map((row) => `${row.course?.name || row.title} ${formatDateTime(row.startAt)}`), href, "节");
}

export async function landForUtterance(actor: Actor, text: string) {
  const compact = text.replace(/\s+/g, "");
  const home = actor.area === "teacher" ? "/teacher" : "/owner";
  if (!compact || compact.startsWith("系统已执行")) return { href: home };
  if (actor.area === "teacher") {
    const student = named(await people(actor), text);
    if (/报告/.test(compact)) return { href: "/teacher/reports" };
    if (/记录/.test(compact)) return { href: "/teacher/records" };
    if (/课|考勤|点名/.test(compact)) {
      const lesson = await lessonFor(actor, text);
      if (lesson) return { href: `/teacher/schedule?view=day&date=${shanghaiDateKey(lesson.startAt)}&lesson=${lesson.id}` };
      return { href: "/teacher/schedule" };
    }
    if (student) return { href: `/teacher/students#student-${student.id}` };
    if (/学生/.test(compact)) return { href: "/teacher/students" };
    return { href: home };
  }
  if (/新增学生|添加学生|新建学生|学生建档/.test(compact) || (/姓名/.test(compact) && /家长|手机/.test(compact))) return { href: stamp("/owner/students?create=1") };
  if (/导入学生|批量导入/.test(compact)) return { href: stamp("/owner/students?form=import") };
  if (/新增教师|添加教师|新建教师/.test(compact)) return { href: stamp("/owner/teachers?form=create") };
  if (/创建课程|新建课程|添加课程/.test(compact)) return { href: stamp("/owner/courses?form=course") };
  if (/创建班级|新建班级|添加班级/.test(compact)) return { href: stamp("/owner/courses?form=class") };
  if (/添加教室|新建教室|新增教室/.test(compact)) return { href: stamp("/owner/rooms?form=create") };
  if (/周期排课/.test(compact)) return { href: stamp("/owner/schedule?form=recurring") };
  if (/创建课次|新建课次|排一节|去排课|我要排课/.test(compact)) return { href: stamp("/owner/schedule?form=lesson") };
  const student = named(await people(actor), text);
  if (/报名/.test(compact)) {
    return { href: student ? stamp(`/owner/billing?form=enroll&who=${student.id}`) : stamp("/owner/billing?form=enroll") };
  }
  if (student && /课时|收款|续费|欠费/.test(compact)) return { href: `/owner/billing?who=${student.id}&focus=${encodeURIComponent(student.id)}` };
  if (student && /报告/.test(compact)) return { href: `/owner/reports?all=1&q=${encodeURIComponent(student.name)}` };
  if (student && /出勤|考勤|点名/.test(compact)) return { href: `/owner/attendance?range=last7days&q=${encodeURIComponent(student.name)}` };
  if (/调课|课次|课表|排课/.test(compact)) {
    const lesson = await lessonFor(actor, text);
    if (lesson && /这节|这堂|课次详情|点名|考勤/.test(compact)) return { href: `/owner/schedule?view=day&date=${shanghaiDateKey(lesson.startAt)}&lesson=${lesson.id}` };
    return { href: "/owner/schedule" };
  }
  if (/出勤|考勤|点名/.test(compact)) return { href: "/owner/attendance?range=last7days" };
  if (/报告/.test(compact)) return { href: "/owner/reports" };
  if (student) return { href: `/owner/students?student=${student.id}` };
  const teachers = await prisma.teacher.findMany({ where: { organizationId: actor.organizationId }, select: { id: true, name: true }, take: 200 });
  const teacher = named(teachers, text);
  if (teacher) return { href: `/owner/teachers?teacher=${teacher.id}` };
  if (/学生|学员/.test(compact)) return { href: "/owner/students" };
  if (/教师|老师/.test(compact)) return { href: "/owner/teachers" };
  if (/课程|班级/.test(compact)) return { href: "/owner/courses" };
  if (/教室/.test(compact)) return { href: "/owner/rooms" };
  if (/待办/.test(compact)) return { href: "/owner/todos" };
  if (/操作记录|日志/.test(compact)) return { href: "/owner/audit" };
  if (/统计|概况|概览/.test(compact)) return { href: "/owner/stats" };
  if (/设置/.test(compact)) return { href: "/owner/settings" };
  if (/账号/.test(compact)) return { href: "/owner/account" };
  return { href: home };
}
