"use server";

import { revalidatePath } from "next/cache";
import { MemberStatus, Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth";
import { calendarDateKey, canDeactivateEnrollment, periodValidity } from "@/lib/course-hours";
import { shanghaiDateKey } from "@/lib/datetime";
import { cellAt, decodeCsvBytes, headerMap, parseCsv } from "@/lib/student-import";
import { prisma } from "@/lib/prisma";
import { parseAge, parseMainlandPhone } from "@/lib/student-profile";

export type FieldErrors = Partial<Record<"name" | "studentNo" | "grade" | "age" | "guardianName" | "guardianPhone" | "contactNote", string>>;

export type ActionResult = {
  ok: boolean;
  message?: string;
  fieldErrors?: FieldErrors;
};

export type ImportFailure = { row: number; reason: string };

export type ImportResult = {
  ok: boolean;
  message?: string;
  created: number;
  failed: ImportFailure[];
};

function clean(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function validateStudent(formData: FormData) {
  const fieldErrors: FieldErrors = {};
  const name = clean(formData.get("name"));
  const studentNo = clean(formData.get("studentNo"));
  const grade = clean(formData.get("grade"));
  const parsedAge = parseAge(formData.get("age"));
  const guardianName = clean(formData.get("guardianName"));
  const guardianPhone = parseMainlandPhone(clean(formData.get("guardianPhone")), false);
  const contactNote = clean(formData.get("contactNote"));

  if (!name) fieldErrors.name = "请填写学生姓名。";
  else if (name.length > 40) fieldErrors.name = "姓名不能超过 40 个字。";
  if (studentNo && !/^[A-Za-z0-9-]{1,32}$/.test(studentNo)) {
    fieldErrors.studentNo = "编号只能包含字母、数字和短横线，最多 32 位。";
  }
  if (grade.length > 40) fieldErrors.grade = "年级不能超过 40 个字。";
  if (parsedAge.error) fieldErrors.age = parsedAge.error;
  if (guardianName.length > 40) fieldErrors.guardianName = "家长姓名不能超过 40 个字。";
  if (guardianPhone.error) fieldErrors.guardianPhone = guardianPhone.error;
  if (contactNote.length > 200) fieldErrors.contactNote = "联系备注不能超过 200 个字。";

  return {
    fieldErrors,
    data: {
      name,
      studentNo: studentNo || null,
      grade: grade || null,
      age: parsedAge.age,
      guardianName: guardianName || null,
      guardianPhone: guardianPhone.phone,
      contactNote: contactNote || null,
    },
  };
}

async function nextStudentNo(organizationId: string) {
  const rows = await prisma.student.findMany({
    where: { organizationId },
    select: { studentNo: true },
  });
  let max = 0;
  for (const row of rows) {
    const match = /^STU-(\d+)$/.exec(row.studentNo ?? "");
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `STU-${String(max + 1).padStart(4, "0")}`;
}

function duplicate(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function createStudent(formData: FormData): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  const { fieldErrors, data } = validateStudent(formData);
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  try {
    await prisma.student.create({
      data: {
        organizationId: user.organizationId,
        name: data.name,
        studentNo: data.studentNo ?? (await nextStudentNo(user.organizationId)),
        grade: data.grade,
        age: data.age,
        guardianName: data.guardianName,
        guardianPhone: data.guardianPhone,
        contactNote: data.contactNote,
      },
    });
  } catch (error) {
    if (duplicate(error)) return { ok: false, fieldErrors: { studentNo: "这个编号在本机构已经存在。" } };
    throw error;
  }

  revalidatePath("/owner/students");
  return { ok: true };
}

function formatStudentNo(value: number) {
  return `STU-${String(value).padStart(4, "0")}`;
}

export async function importStudents(formData: FormData): Promise<ImportResult> {
  const user = await requireRole("OWNER", "owner");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, created: 0, failed: [], message: "请选择一个 CSV 文件。" };
  if (!file.name.toLowerCase().endsWith(".csv")) return { ok: false, created: 0, failed: [], message: "只允许上传 .csv 文件。" };
  if (file.size > 1024 * 1024) return { ok: false, created: 0, failed: [], message: "文件不能超过 1 MB。" };

  const text = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
  const parsed = parseCsv(text);
  const table = /^sep=/i.test(parsed[0]?.cells[0] ?? "") ? parsed.slice(1) : parsed;
  const header = table[0];
  if (!header) return { ok: false, created: 0, failed: [], message: "文件是空的。" };
  const columns = headerMap(header.cells);
  if (!columns.has("name")) return { ok: false, created: 0, failed: [], message: "表头需要包含「姓名」。请使用下载的模板。" };

  const failed: ImportFailure[] = [];
  const ready: {
    row: number;
    name: string;
    grade: string | null;
    age: number | null;
    guardianPhone: string | null;
    contactNote: string | null;
    studentNo: string | null;
  }[] = [];
  const seenNos = new Set<string>();
  for (const record of table.slice(1, 501)) {
    const name = cellAt(record.cells, columns, "name");
    const grade = cellAt(record.cells, columns, "grade");
    const ageText = cellAt(record.cells, columns, "age");
    const phone = cellAt(record.cells, columns, "phone");
    const note = cellAt(record.cells, columns, "note");
    const studentNo = cellAt(record.cells, columns, "studentNo");
    if (!name && !grade && !ageText && !phone && !note && !studentNo) continue;
    // 跳过下载模板里的示例行，避免误导入「张三」（备注清空或仍含删除提示时同样跳过）。
    if (
      name === "张三" &&
      phone === "13800000000" &&
      (!note || note === "无" || note === "示例" || note.includes("删除") || note.includes("示例"))
    ) {
      continue;
    }
    if (!name) {
      failed.push({ row: record.line, reason: "姓名为空" });
      continue;
    }
    if (name.length > 40) {
      failed.push({ row: record.line, reason: "姓名不能超过 40 个字" });
      continue;
    }
    if (grade.length > 40) {
      failed.push({ row: record.line, reason: "年级不能超过 40 个字" });
      continue;
    }
    const parsedAge = parseAge(ageText);
    if (parsedAge.error) {
      failed.push({ row: record.line, reason: parsedAge.error });
      continue;
    }
    if (phone && !/^1[3-9]\d{9}$/.test(phone)) {
      failed.push({ row: record.line, reason: "家长手机号不是 11 位大陆手机号" });
      continue;
    }
    if (studentNo && !/^[A-Za-z0-9-]{1,32}$/.test(studentNo)) {
      failed.push({ row: record.line, reason: "编号只能包含字母、数字和短横线" });
      continue;
    }
    if (studentNo && seenNos.has(studentNo.toLowerCase())) {
      failed.push({ row: record.line, reason: "编号在文件中重复" });
      continue;
    }
    if (note.length > 200) {
      failed.push({ row: record.line, reason: "备注过长" });
      continue;
    }
    if (studentNo) seenNos.add(studentNo.toLowerCase());
    ready.push({
      row: record.line,
      name,
      grade: grade || null,
      age: parsedAge.age,
      guardianPhone: phone || null,
      contactNote: note || null,
      studentNo: studentNo || null,
    });
  }
  if (table.length > 501) failed.push({ row: 502, reason: "一次最多导入 500 行，超出的行已忽略" });

  const existing = await prisma.student.findMany({
    where: { organizationId: user.organizationId },
    select: { studentNo: true },
  });
  const used = new Set(existing.map((row) => row.studentNo?.toLowerCase()).filter((value): value is string => Boolean(value)));
  let next = 0;
  for (const row of existing) {
    const match = /^STU-(\d+)$/.exec(row.studentNo ?? "");
    if (match) next = Math.max(next, Number(match[1]));
  }

  let created = 0;
  for (const row of ready) {
    let studentNo = row.studentNo;
    if (studentNo && used.has(studentNo.toLowerCase())) {
      failed.push({ row: row.row, reason: "编号在本机构已经存在" });
      continue;
    }
    if (!studentNo) {
      do {
        next += 1;
        studentNo = formatStudentNo(next);
      } while (used.has(studentNo.toLowerCase()));
    }
    try {
      await prisma.student.create({
        data: {
          organizationId: user.organizationId,
          name: row.name,
          studentNo,
          grade: row.grade,
          age: row.age,
          guardianPhone: row.guardianPhone,
          contactNote: row.contactNote,
        },
      });
      used.add(studentNo.toLowerCase());
      created += 1;
    } catch (error) {
      if (duplicate(error)) failed.push({ row: row.row, reason: "编号在本机构已经存在" });
      else throw error;
    }
  }

  failed.sort((left, right) => left.row - right.row);
  revalidatePath("/owner/students");
  return { ok: true, created, failed };
}

export async function updateStudent(id: string, formData: FormData): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  const existing = await prisma.student.findFirst({
    where: { id, organizationId: user.organizationId },
    select: { id: true },
  });
  if (!existing) return { ok: false, message: "找不到这名学生，或你无权修改。" };

  const { fieldErrors, data } = validateStudent(formData);
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  if (!data.studentNo) fieldErrors.studentNo = "请填写学生编号。";
  if (fieldErrors.studentNo) return { ok: false, fieldErrors };

  try {
    await prisma.student.updateMany({
      where: { id, organizationId: user.organizationId },
      data,
    });
  } catch (error) {
    if (duplicate(error)) return { ok: false, fieldErrors: { studentNo: "这个编号在本机构已经存在。" } };
    throw error;
  }

  revalidatePath("/owner/students");
  return { ok: true };
}

export async function setStudentStatus(id: string, status: MemberStatus): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  if (status !== "ACTIVE" && status !== "INACTIVE") return { ok: false, message: "状态无效。" };

  const existing = await prisma.student.findFirst({
    where: { id, organizationId: user.organizationId },
    select: { id: true, status: true },
  });
  if (!existing) return { ok: false, message: "找不到这名学生，或你无权修改。" };
  if (existing.status === status) {
    revalidatePath("/owner/students");
    return { ok: true };
  }

  const result = await prisma.student.updateMany({
    where: { id, organizationId: user.organizationId, status: existing.status },
    data: status === "ACTIVE" ? { status, archiveReason: null } : { status },
  });
  if (result.count !== 1) return { ok: false, message: "状态没有更新，请刷新后再试。" };

  if (status === "INACTIVE") {
    await writeAudit(prisma, {
      organizationId: user.organizationId,
      actorId: user.id,
      action: "STUDENT_DEACTIVATED",
      targetType: "Student",
      targetId: id,
      detail: "负责人停用学生",
    });
  }

  refreshStudentViews();
  return { ok: true };
}

export async function deactivateStudent(studentId: string, courseId: string, reason: string): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  const text = reason.trim();
  if (!text) return { ok: false, message: "请填写停用原因。" };
  if (text.length > 80) return { ok: false, message: "停用原因不能超过 80 个字。" };
  if (!courseId) return { ok: false, message: "请从对应的报名记录停用。" };

  const student = await prisma.student.findFirst({
    where: { id: studentId, organizationId: user.organizationId, status: "ACTIVE" },
    select: {
      id: true,
      enrollments: {
        select: { courseId: true, startDate: true, endDate: true, course: { select: { name: true, billingType: true } } },
      },
      courseHourBalances: { select: { courseId: true, remainingHours: true } },
    },
  });
  if (!student || !student.enrollments.some((row) => row.courseId === courseId)) {
    return { ok: false, message: "找不到这名在读学员的报名，或你无权停用。" };
  }

  const today = shanghaiDateKey();
  const byCourse = new Map<string, { name: string; billingType: "PER_LESSON" | "PER_PERIOD"; windows: { start: string; end: string }[] }>();
  for (const row of student.enrollments) {
    const current = byCourse.get(row.courseId) ?? { name: row.course.name, billingType: row.course.billingType, windows: [] };
    if (row.startDate && row.endDate) current.windows.push({ start: calendarDateKey(row.startDate), end: calendarDateKey(row.endDate) });
    byCourse.set(row.courseId, current);
  }
  const courseState = (id: string) => {
    const course = byCourse.get(id);
    if (!course) return null;
    const period = course.billingType === "PER_PERIOD" ? periodValidity(course.windows, today) : null;
    const remainingHours = course.billingType === "PER_LESSON"
      ? student.courseHourBalances.find((item) => item.courseId === id)?.remainingHours ?? 0
      : 0;
    return {
      name: course.name,
      finished: canDeactivateEnrollment({ billingType: course.billingType, remainingHours, periodStatus: period?.status ?? null }),
    };
  };
  const selected = courseState(courseId);
  if (!selected?.finished) return { ok: false, message: "只有剩余课时为 0，或周期课程已过期时，才能停用这名学员。" };
  const stillOpen = [...byCourse.keys()].filter((id) => id !== courseId && courseState(id)?.finished === false).map((id) => courseState(id)?.name).filter((name): name is string => Boolean(name));
  if (stillOpen.length > 0) return { ok: false, message: `这名学员在「${stillOpen.join("、")}」还有课时或有效期，不能整人停用。` };

  const result = await prisma.student.updateMany({
    where: { id: student.id, organizationId: user.organizationId, status: "ACTIVE" },
    data: { status: "INACTIVE", archiveReason: text },
  });
  if (result.count !== 1) return { ok: false, message: "状态没有更新，请刷新后再试。" };

  await writeAudit(prisma, {
    organizationId: user.organizationId,
    actorId: user.id,
    action: "STUDENT_DEACTIVATED",
    targetType: "Student",
    targetId: student.id,
    detail: `报名页停用学生：${text}`,
  });
  refreshStudentViews();
  return { ok: true };
}

function refreshStudentViews() {
  revalidatePath("/owner/students");
  revalidatePath("/owner/billing");
  revalidatePath("/owner/schedule");
  revalidatePath("/parent");
  revalidatePath("/parent/schedule");
  revalidatePath("/teacher");
  revalidatePath("/teacher/schedule");
  revalidatePath("/teacher/students");
  revalidatePath("/teacher/records");
}
