import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import path from "node:path";
import { pathToFileURL } from "node:url";

process.loadEnvFile(".env");

const prisma = new PrismaClient();
export const DEMO_PASSWORD = "edupilot2026";
export const DEMO_EMAILS = [
  "demo_owner@edupilot.test",
  "demo_teacher@edupilot.test",
  "demo_parent@edupilot.test",
];
const password = DEMO_PASSWORD;
const organizationName = "启明星素质成长中心";

function shanghaiKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function shiftKey(dateKey, days) {
  const noon = new Date(`${dateKey}T12:00:00+08:00`);
  return shanghaiKey(new Date(noon.getTime() + days * 24 * 60 * 60 * 1000));
}

function at(dateKey, time) {
  return new Date(`${dateKey}T${time}:00+08:00`);
}

function onDay(dateKey, hour, minute) {
  return new Date(`${dateKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`);
}

async function clearBusinessData() {
  await prisma.$transaction(async (tx) => {
    await tx.homeworkAsset.deleteMany();
    await tx.homeworkSubmission.deleteMany();
    await tx.reportPhoto.deleteMany();
    await tx.reportReply.deleteMany();
    await tx.reportRead.deleteMany();
    await tx.examRead.deleteMany();
    await tx.examResult.deleteMany();
    await tx.exam.deleteMany();
    await tx.parentNotice.deleteMany();
    await tx.lessonChangeRequest.deleteMany();
    await tx.teachingReport.deleteMany();
    await tx.teachingRecord.deleteMany();
    await tx.lessonStudent.deleteMany();
    await tx.hourAdjustment.deleteMany();
    await tx.payment.deleteMany();
    await tx.renewalFollowUp.deleteMany();
    await tx.courseHourBalance.deleteMany();
    await tx.enrollment.deleteMany();
    await tx.lessonSession.deleteMany();
    await tx.classWaitlist.deleteMany();
    await tx.membershipInvite.deleteMany();
    await tx.parentStudentLink.deleteMany();
    await tx.auditLog.deleteMany();
    await tx.classGroup.deleteMany();
    await tx.teacherCourse.deleteMany();
    await tx.course.deleteMany();
    await tx.teacher.deleteMany();
    await tx.classroom.deleteMany();
    await tx.user.deleteMany();
    await tx.student.deleteMany();
    await tx.organization.deleteMany();
    await tx.phoneVerification.deleteMany();
    await tx.phoneSignup.deleteMany();
  }, { timeout: 120000 });
}

export async function seedDemoOrganization(prisma) {
  const today = shanghaiKey();
  const yesterday = shiftKey(today, -1);
  const tomorrow = shiftKey(today, 1);
  const earlier = shiftKey(today, -6);
  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date();

  const organization = await prisma.organization.create({
    data: {
      name: organizationName,
      timezone: "Asia/Shanghai",
      businessTypes: ["ACADEMIC", "ART", "EARLY_CHILDHOOD"],
      reportLanguage: "zh-CN",
    },
  });

  const owner = await prisma.user.create({
    data: { organizationId: organization.id, email: "demo_owner@edupilot.test", name: "周校长", passwordHash, roles: ["OWNER"] },
  });
  const teacherUser = await prisma.user.create({
    data: { organizationId: organization.id, email: "demo_teacher@edupilot.test", name: "王建国", passwordHash, roles: ["TEACHER"] },
  });
  const parent = await prisma.user.create({
    data: { organizationId: organization.id, email: "demo_parent@edupilot.test", name: "林子涵家长", passwordHash, roles: ["PARENT"] },
  });

  const wang = await prisma.teacher.create({
    data: { organizationId: organization.id, name: "王建国", phone: "13800001001", wechat: "wang_jg", userId: teacherUser.id, accountUserId: teacherUser.id, createdAt: onDay(shiftKey(today, -40), 9, 0) },
  });
  const zhao = await prisma.teacher.create({
    data: { organizationId: organization.id, name: "赵明", phone: "13800001002", createdAt: onDay(shiftKey(today, -38), 9, 0) },
  });
  const sun = await prisma.teacher.create({
    data: { organizationId: organization.id, name: "孙悦", phone: "13800001003", createdAt: onDay(shiftKey(today, -36), 9, 0) },
  });
  const li = await prisma.teacher.create({
    data: { organizationId: organization.id, name: "李小红", phone: "13800001004", createdAt: onDay(shiftKey(today, -30), 9, 0) },
  });

  const studentRows = [
    ["林子涵", "初二", "STU-0001", -12],
    ["陈可欣", "初二", "STU-0002", -20],
    ["周予安", "初三", "STU-0003", -8],
    ["许沐阳", "初三", "STU-0004", -3],
    ["苏晚宁", "小学三年级", "STU-0005", -15],
    ["何知夏", "小学一年级", "STU-0006", 0],
    ["沈清禾", "初一", "STU-0007", -6],
    ["顾星野", "初二", "STU-0008", -2],
    ["江晚晴", "初三", "STU-0009", -18],
    ["郑一鸣", "初二", "STU-0010", -1],
  ];
  const students = {};
  for (const [name, grade, studentNo, dayOffset] of studentRows) {
    const createdAt = onDay(shiftKey(today, dayOffset), 10, 0);
    students[name] = await prisma.student.create({
      data: { organizationId: organization.id, name, grade, studentNo, status: "ACTIVE", createdAt, updatedAt: createdAt },
    });
  }

  await prisma.parentStudentLink.create({
    data: { organizationId: organization.id, parentUserId: parent.id, studentId: students["林子涵"].id },
  });

  const math = await prisma.course.create({
    data: { organizationId: organization.id, name: "初二数学培优", category: "ACADEMIC", billingType: "PER_LESSON", description: "函数、几何和压轴题的小班精讲。按课时扣减。" },
  });
  const english = await prisma.course.create({
    data: {
      organizationId: organization.id,
      name: "初三英语冲刺（半年卡）",
      category: "ACADEMIC",
      billingType: "PER_PERIOD",
      description: "按学期收费。有效期内出勤不扣课时。",
    },
  });
  const piano = await prisma.course.create({
    data: { organizationId: organization.id, name: "少儿钢琴启蒙", category: "ART", description: "识谱、手型和简单曲目。" },
  });
  const art = await prisma.course.create({
    data: { organizationId: organization.id, name: "创意美术", category: "ART", description: "观察、构图和色彩练习。" },
  });

  const classes = {
    mathA: await prisma.classGroup.create({ data: { organizationId: organization.id, name: "初二数学培优 A 班", courseId: math.id, teacherId: wang.id, capacity: 8 } }),
    mathB: await prisma.classGroup.create({ data: { organizationId: organization.id, name: "初二数学培优 B 班", courseId: math.id, teacherId: zhao.id, capacity: 8 } }),
    english: await prisma.classGroup.create({ data: { organizationId: organization.id, name: "初三英语冲刺班", courseId: english.id, teacherId: sun.id, capacity: 10 } }),
    piano: await prisma.classGroup.create({ data: { organizationId: organization.id, name: "少儿钢琴启蒙小班", courseId: piano.id, teacherId: li.id, capacity: 6 } }),
    art: await prisma.classGroup.create({ data: { organizationId: organization.id, name: "创意美术周末班", courseId: art.id, teacherId: zhao.id, capacity: 10 } }),
  };

  await prisma.teacherCourse.createMany({
    data: [
      { teacherId: wang.id, courseId: math.id },
      { teacherId: zhao.id, courseId: math.id },
      { teacherId: zhao.id, courseId: art.id },
      { teacherId: sun.id, courseId: english.id },
      { teacherId: li.id, courseId: piano.id },
    ],
  });

  async function addLesson({ classGroup, course, teacher, title, start, end, location, status, roster }) {
    const lesson = await prisma.lessonSession.create({
      data: {
        organizationId: organization.id,
        classGroupId: classGroup.id,
        courseId: course.id,
        teacherId: teacher.id,
        title,
        startAt: start,
        endAt: end,
        location,
        status,
        createdById: owner.id,
      },
    });
    for (const person of roster) {
      await prisma.lessonStudent.create({
        data: {
          organizationId: organization.id,
          lessonSessionId: lesson.id,
          studentId: students[person.name].id,
          attendanceStatus: person.attendance,
          attendanceNote: person.note ?? null,
          hoursCharged: person.charged === true,
          lastAction: person.charged ? "出勤扣减 1 课时" : null,
        },
      });
    }
    return lesson;
  }

  const liveStart = new Date(now.getTime() - 15 * 60 * 1000);
  const liveEnd = new Date(now.getTime() + 35 * 60 * 1000);

  await addLesson({
    classGroup: classes.mathA, course: math, teacher: wang, title: "一次函数图像", start: at(earlier, "16:00"), end: at(earlier, "17:30"), location: "A201", status: "COMPLETED",
    roster: [
      { name: "林子涵", attendance: "PRESENT", charged: true },
      { name: "陈可欣", attendance: "PRESENT", charged: true },
    ],
  });
  await addLesson({
    classGroup: classes.english, course: english, teacher: sun, title: "阅读长难句", start: at(earlier, "18:30"), end: at(earlier, "20:00"), location: "英语教室", status: "COMPLETED",
    roster: [
      { name: "周予安", attendance: "PRESENT", charged: false },
      { name: "江晚晴", attendance: "PRESENT", charged: false },
      { name: "许沐阳", attendance: "LATE", note: "晚到 8 分钟", charged: false },
    ],
  });
  await addLesson({
    classGroup: classes.mathB, course: math, teacher: zhao, title: "几何辅助线", start: at(shiftKey(today, -5), "15:00"), end: at(shiftKey(today, -5), "16:30"), location: "A203", status: "COMPLETED",
    roster: [
      { name: "郑一鸣", attendance: "PRESENT", charged: true },
      { name: "顾星野", attendance: "PRESENT", charged: true },
    ],
  });

  const yesterdayMath = await addLesson({
    classGroup: classes.mathA, course: math, teacher: wang, title: "二次函数开口与顶点", start: at(yesterday, "16:00"), end: at(yesterday, "17:30"), location: "A201", status: "COMPLETED",
    roster: [
      { name: "林子涵", attendance: "PRESENT", note: "全程跟上例题", charged: true },
      { name: "陈可欣", attendance: "LATE", note: "晚到 12 分钟，补做了例题 2", charged: true },
    ],
  });
  const yesterdayEnglish = await addLesson({
    classGroup: classes.english, course: english, teacher: sun, title: "完形填空上下文", start: at(yesterday, "18:40"), end: at(yesterday, "20:10"), location: "英语教室", status: "COMPLETED",
    roster: [
      { name: "周予安", attendance: "PRESENT", charged: false },
      { name: "许沐阳", attendance: "LEAVE", note: "家长提前请假，去校队训练", charged: false },
      { name: "江晚晴", attendance: "PRESENT", charged: false },
    ],
  });
  await addLesson({
    classGroup: classes.piano, course: piano, teacher: li, title: "拜厄第 18 首", start: at(yesterday, "10:00"), end: at(yesterday, "11:00"), location: "钢琴房", status: "COMPLETED",
    roster: [
      { name: "苏晚宁", attendance: "PRESENT", charged: true },
      { name: "何知夏", attendance: "LEAVE", note: "感冒请假", charged: false },
    ],
  });
  await addLesson({
    classGroup: classes.art, course: art, teacher: zhao, title: "静物明暗", start: at(yesterday, "14:00"), end: at(yesterday, "15:30"), location: "美术教室", status: "COMPLETED",
    roster: [
      { name: "沈清禾", attendance: "PRESENT", charged: true },
      { name: "顾星野", attendance: "LATE", note: "晚到 6 分钟", charged: true },
    ],
  });

  const todayMath = await addLesson({
    classGroup: classes.mathA, course: math, teacher: wang, title: "二次函数实际应用", start: at(today, "09:00"), end: at(today, "10:30"), location: "A201", status: "COMPLETED",
    roster: [
      { name: "林子涵", attendance: "PRESENT", charged: true },
      { name: "陈可欣", attendance: "PRESENT", charged: true },
    ],
  });
  const todayEnglish = await addLesson({
    classGroup: classes.english, course: english, teacher: sun, title: "听力场景词", start: at(today, "14:00"), end: at(today, "15:30"), location: "英语教室", status: "COMPLETED",
    roster: [
      { name: "周予安", attendance: "PRESENT", charged: false },
      { name: "江晚晴", attendance: "LATE", note: "晚到 5 分钟", charged: false },
      { name: "许沐阳", attendance: "PRESENT", charged: false },
    ],
  });
  await addLesson({
    classGroup: classes.piano, course: piano, teacher: li, title: "双手配合练习", start: at(today, "19:00"), end: at(today, "20:00"), location: "钢琴房", status: "COMPLETED",
    roster: [
      { name: "苏晚宁", attendance: "PRESENT", charged: true },
      { name: "何知夏", attendance: "PRESENT", charged: true },
    ],
  });
  await addLesson({
    classGroup: classes.mathA, course: math, teacher: wang, title: "晚间数学答疑", start: liveStart, end: liveEnd, location: "A201", status: "SCHEDULED",
    roster: [
      { name: "林子涵", attendance: "NOT_MARKED" },
      { name: "陈可欣", attendance: "NOT_MARKED" },
    ],
  });

  await addLesson({
    classGroup: classes.mathB, course: math, teacher: zhao, title: "相似三角形", start: at(tomorrow, "15:00"), end: at(tomorrow, "16:30"), location: "A203", status: "SCHEDULED",
    roster: [
      { name: "郑一鸣", attendance: "NOT_MARKED" },
      { name: "顾星野", attendance: "NOT_MARKED" },
    ],
  });
  await addLesson({
    classGroup: classes.english, course: english, teacher: sun, title: "书面表达提纲", start: at(tomorrow, "16:40"), end: at(tomorrow, "18:10"), location: "英语教室", status: "SCHEDULED",
    roster: [
      { name: "周予安", attendance: "NOT_MARKED" },
      { name: "许沐阳", attendance: "NOT_MARKED" },
      { name: "江晚晴", attendance: "NOT_MARKED" },
    ],
  });
  await addLesson({
    classGroup: classes.piano, course: piano, teacher: li, title: "节奏与断句", start: at(tomorrow, "10:00"), end: at(tomorrow, "11:00"), location: "钢琴房", status: "SCHEDULED",
    roster: [
      { name: "苏晚宁", attendance: "NOT_MARKED" },
      { name: "何知夏", attendance: "NOT_MARKED" },
    ],
  });
  await addLesson({
    classGroup: classes.mathA, course: math, teacher: wang, title: "课前小测讲评", start: at(tomorrow, "16:00"), end: at(tomorrow, "17:30"), location: "A201", status: "SCHEDULED",
    roster: [
      { name: "林子涵", attendance: "NOT_MARKED" },
      { name: "陈可欣", attendance: "NOT_MARKED" },
    ],
  });

  async function recordFor(lesson, teacher, fields) {
    return prisma.teachingRecord.create({
      data: {
        organizationId: organization.id,
        lessonSessionId: lesson.id,
        teacherId: teacher.id,
        lessonContent: fields.content,
        studentPerformance: fields.performance,
        difficulties: fields.difficulties,
        homework: fields.homework,
        teacherPrivateNote: fields.privateNote ?? null,
      },
    });
  }

  const yesterdayMathRecord = await recordFor(yesterdayMath, wang, {
    content: "用抛物线顶点式复习开口方向，现场画了 y=x² 和 y=-x²+2，再让学生标出顶点和对称轴。",
    performance: "林子涵能独立说出顶点坐标，并指出对称轴两边函数值相同。陈可欣晚到后补完例题，计算还是容易漏符号。",
    difficulties: "把顶点式改写成一般式时，展开后的一次项系数容易写错。",
    homework: "练习册 P42 第 3、5、8 题，要求先标顶点再画草图。",
    privateNote: "该生最近沉迷游戏，需家长关注。林子涵连续两次课前打哈欠，先不写进给家长的报告。",
  });
  const yesterdayEnglishRecord = await recordFor(yesterdayEnglish, sun, {
    content: "用一篇校园义卖完形练习上下文线索，带着学生先通读再回头填空。",
    performance: "周予安能根据转折词判断情绪变化。许沐阳请假。江晚晴前两空选得很快，后半段开始凭感觉。",
    difficulties: "近义词辨析还停在中文翻译，没有回到原句检查搭配。",
    homework: "重做课堂那篇完形的后 5 空，并写出选择理由。",
    privateNote: "江晚晴说最近晚上写作业拖到很晚，先观察一周，不在家长报告里点名。",
  });
  const todayMathRecord = await recordFor(todayMath, wang, {
    content: "用围矩形场地的题目讲二次函数最大值。学生先列式，再配方，最后解释顶点为什么就是最大面积。",
    performance: "林子涵列出了正确的面积公式，并能说明自变量的取值范围。陈可欣公式对了，但代入端点时少看了一个条件。",
    difficulties: "实际问题里容易忘记自变量不能取到使边长为零的值。",
    homework: "完成一张围篱笆的变式题，写出取值范围。",
    privateNote: "该生最近沉迷游戏，需家长关注。今天状态比昨天好，报告里只写课堂表现。",
  });
  const todayEnglishRecord = await recordFor(todayEnglish, sun, {
    content: "听了三段校园对话，先抓地点和数字，再核对干扰项。",
    performance: "周予安能在第一遍就记下时间和房间号。江晚晴晚到，第二段的价格听成了折扣前的原价。",
    difficulties: "数字和房间号连读时，学生会把 thirteen 和 thirty 听混。",
    homework: "重听第二段，把价格和地点各写一遍。",
  });

  await prisma.teachingReport.create({
    data: {
      organizationId: organization.id,
      lessonSessionId: yesterdayMath.id,
      studentId: students["林子涵"].id,
      teachingRecordId: yesterdayMathRecord.id,
      status: "CONFIRMED",
      summary: "这节课复习了抛物线的开口方向、顶点和对称轴。林子涵能独立标出顶点，并说明对称轴两侧的函数值相同。",
      strengths: "图像判断稳定，能把顶点式和图像对应起来。",
      issues: "把顶点式展开成一般式时，一次项系数还会写错。",
      nextSteps: "下次先用两个展开题热身，再进入应用题。",
      homeworkSummary: "练习册 P42 第 3、5、8 题，先标顶点再画草图。",
      aiModel: "demo-seed",
      promptVersion: "seed-1",
      generatedAt: at(yesterday, "17:40"),
      confirmedById: teacherUser.id,
      confirmedAt: at(yesterday, "18:05"),
    },
  });
  await prisma.teachingReport.create({
    data: {
      organizationId: organization.id,
      lessonSessionId: yesterdayMath.id,
      studentId: students["陈可欣"].id,
      teachingRecordId: yesterdayMathRecord.id,
      status: "DRAFT",
      summary: "陈可欣晚到后补完了顶点例题，计算过程里符号还不稳定。",
      strengths: "补做例题时能跟着图像找到顶点。",
      issues: "展开式的符号容易漏。",
      nextSteps: "先订正课堂例题，再完成作业。",
      homeworkSummary: "练习册 P42 第 3、5 题。",
      aiModel: "demo-seed",
      promptVersion: "seed-1",
      generatedAt: at(yesterday, "17:42"),
    },
  });
  await prisma.teachingReport.create({
    data: {
      organizationId: organization.id,
      lessonSessionId: yesterdayEnglish.id,
      studentId: students["周予安"].id,
      teachingRecordId: yesterdayEnglishRecord.id,
      status: "CONFIRMED",
      summary: "周予安能根据转折词判断文章情绪，完形前半段选择有依据。",
      strengths: "会回到原句检查，而不是只看选项。",
      issues: "近义词还习惯先翻译成中文。",
      nextSteps: "用搭配而不是中文意思来排除选项。",
      homeworkSummary: "重做课堂完形的后 5 空，并写选择理由。",
      aiModel: "demo-seed",
      promptVersion: "seed-1",
      generatedAt: at(yesterday, "20:20"),
      confirmedById: teacherUser.id,
      confirmedAt: at(yesterday, "20:40"),
    },
  });
  await prisma.teachingReport.create({
    data: {
      organizationId: organization.id,
      lessonSessionId: todayMath.id,
      studentId: students["林子涵"].id,
      teachingRecordId: todayMathRecord.id,
      status: "PUBLISHED",
      summary: "今天用围矩形场地的题目练习二次函数最大值。林子涵列出了面积公式，也能说明边长不能取到零。",
      strengths: "能把公式、图像和实际限制连在一起讲清楚。",
      issues: "配方后的最后一步书写还不够整齐，检查时容易看串行。",
      nextSteps: "保留今天的解题步骤，下次直接做一道变式并口述取值范围。",
      homeworkSummary: "完成一张围篱笆变式题，写出自变量的取值范围。",
      aiModel: "demo-seed",
      promptVersion: "seed-1",
      generatedAt: at(today, "10:40"),
      confirmedById: teacherUser.id,
      confirmedAt: at(today, "11:00"),
      publishedById: teacherUser.id,
      publishedAt: at(today, "11:20"),
    },
  });
  await prisma.teachingReport.create({
    data: {
      organizationId: organization.id,
      lessonSessionId: todayEnglish.id,
      studentId: students["周予安"].id,
      teachingRecordId: todayEnglishRecord.id,
      status: "DRAFT",
      summary: "周予安第一遍就能记下对话里的时间和房间号。",
      strengths: "数字记录比较稳。",
      issues: "thirteen 和 thirty 仍需要再听一遍确认。",
      nextSteps: "用暂停重听的方式核对容易混的数字。",
      homeworkSummary: "重听第二段，写下价格和地点。",
      aiModel: "demo-seed",
      promptVersion: "seed-1",
      generatedAt: at(today, "15:40"),
    },
  });

  const purchases = [
    [students["林子涵"], math, classes.mathA, "4800.00", "4800.00", 24, 20, "2026-10-03"],
    [students["陈可欣"], math, classes.mathA, "3600.00", "3600.00", 16, 13, "2026-10-06"],
    [students["苏晚宁"], piano, classes.piano, "3200.00", "3200.00", 16, 14, "2026-10-13"],
    [students["何知夏"], piano, classes.piano, "2400.00", "2400.00", 12, 11, "2026-10-20"],
    [students["沈清禾"], art, classes.art, "1800.00", "1800.00", 12, 11, "2026-10-21"],
    [students["顾星野"], art, classes.art, "1800.00", "1800.00", 12, 10, "2026-09-18"],
    [students["顾星野"], math, classes.mathB, "2400.00", "2400.00", 12, 11, "2026-10-12"],
    [students["郑一鸣"], math, classes.mathB, "2600.00", "2600.00", 10, 6, "2026-10-21"],
  ];
  const periods = [
    [students["周予安"], english, classes.english, "4200.00", "4200.00", "2026-08-01", "2027-01-31", "2026-10-11"],
    [students["许沐阳"], english, classes.english, "4200.00", "3000.00", "2026-08-01", "2027-01-31", "2026-10-18"],
    [students["江晚晴"], english, classes.english, "2100.00", "2100.00", "2026-03-01", "2026-09-30", "2026-09-08"],
  ];
  for (const [student, course, classGroup, due, paid, hoursAdded, remaining, day] of purchases) {
    const paidAt = onDay(day, 11, 30);
    await prisma.enrollment.create({
      data: {
        organizationId: organization.id,
        studentId: student.id,
        courseId: course.id,
        classGroupId: classGroup.id,
        amountDue: due,
        amount: paid,
        hoursAdded,
        status: Number(paid) > 0 ? "PAID" : "UNPAID",
        paidAt,
        createdById: owner.id,
        createdAt: paidAt,
        updatedAt: paidAt,
      },
    });
    await prisma.courseHourBalance.create({
      data: {
        organizationId: organization.id,
        studentId: student.id,
        courseId: course.id,
        remainingHours: remaining,
        createdAt: paidAt,
        updatedAt: now,
      },
    });
  }
  for (const [student, course, classGroup, due, paid, start, end, day] of periods) {
    const paidAt = onDay(day, 11, 30);
    await prisma.enrollment.create({
      data: {
        organizationId: organization.id,
        studentId: student.id,
        courseId: course.id,
        classGroupId: classGroup.id,
        amountDue: due,
        amount: paid,
        hoursAdded: 0,
        startDate: new Date(`${start}T00:00:00.000Z`),
        endDate: new Date(`${end}T00:00:00.000Z`),
        status: Number(paid) > 0 ? "PAID" : "UNPAID",
        paidAt,
        createdById: owner.id,
        createdAt: paidAt,
        updatedAt: paidAt,
      },
    });
  }

  console.log(`机构 ${organization.name}`);
  console.log("demo_owner@edupilot.test 负责人");
  console.log("demo_teacher@edupilot.test 教师");
  console.log("demo_parent@edupilot.test 家长，已绑定林子涵");
  console.log(`课次日期：${yesterday}、${today}、${tomorrow}`);
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("生产环境禁止运行种子脚本（会清空业务数据）。内测请用：npm run beta:ensure-demo");
    process.exit(1);
  }
  if (process.env.SEED_ENABLED !== "true") {
    console.error("未开启 SEED_ENABLED=true，拒绝写入演示数据。");
    process.exit(1);
  }
  await clearBusinessData();
  await seedDemoOrganization(prisma);
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entry) {
  main()
    .then(() => prisma.$disconnect())
    .catch(async (error) => {
      const message = error instanceof Error ? error.message : "seed failed";
      console.error(message.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://***"));
      await prisma.$disconnect();
      process.exit(1);
    });
}
