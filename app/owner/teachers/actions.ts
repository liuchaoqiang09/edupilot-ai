"use server";

import { revalidatePath } from "next/cache";
import { MemberStatus, Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateTeacherFields, type TeacherFieldErrors } from "@/lib/teacher-fields";

export type FieldErrors = TeacherFieldErrors;

export type ActionResult = {
  ok: boolean;
  message?: string;
  fieldErrors?: FieldErrors;
};

function clean(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function validateTeacher(formData: FormData) {
  return validateTeacherFields({
    name: clean(formData.get("name")),
    teacherNo: clean(formData.get("teacherNo")),
    phone: clean(formData.get("phone")),
    wechat: clean(formData.get("wechat")),
  });
}

function duplicate(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function selectedCourseIds(organizationId: string, formData: FormData) {
  const ids = [...new Set(formData.getAll("courseIds").filter((value): value is string => typeof value === "string" && value.length > 0))];
  if (ids.length === 0) return { ids, error: null as string | null };
  const found = await prisma.course.findMany({
    where: { id: { in: ids }, organizationId },
    select: { id: true },
  });
  if (found.length !== ids.length) return { ids: [], error: "有课程不属于当前机构。" };
  return { ids, error: null };
}

function refreshTeachers() {
  revalidatePath("/owner/teachers");
  revalidatePath("/owner/schedule");
}

export async function createTeacher(formData: FormData): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  const { fieldErrors, data } = validateTeacher(formData);
  const courses = await selectedCourseIds(user.organizationId, formData);
  if (courses.error) fieldErrors.courses = courses.error;
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  try {
    await prisma.teacher.create({
      data: {
        organizationId: user.organizationId,
        name: data.name,
        teacherNo: data.teacherNo,
        phone: data.phone,
        wechat: data.wechat,
        courses: { create: courses.ids.map((courseId) => ({ courseId })) },
      },
    });
  } catch (error) {
    if (duplicate(error)) return { ok: false, fieldErrors: { teacherNo: "这个编号在本机构已经存在。" } };
    throw error;
  }
  refreshTeachers();
  return { ok: true };
}

export async function updateTeacher(id: string, formData: FormData): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  const existing = await prisma.teacher.findFirst({
    where: { id, organizationId: user.organizationId },
    select: { id: true },
  });
  if (!existing) return { ok: false, message: "找不到这位教师，或你无权修改。" };

  const { fieldErrors, data } = validateTeacher(formData);
  const courses = await selectedCourseIds(user.organizationId, formData);
  if (courses.error) fieldErrors.courses = courses.error;
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  let updated: { count: number };
  try {
    updated = await prisma.$transaction(async (tx) => {
    const result = await tx.teacher.updateMany({
      where: { id, organizationId: user.organizationId },
      data: { name: data.name, teacherNo: data.teacherNo, phone: data.phone, wechat: data.wechat },
    });
    if (result.count !== 1) return result;
    await tx.teacherCourse.deleteMany({ where: { teacherId: id, teacher: { organizationId: user.organizationId } } });
    if (courses.ids.length > 0) {
      await tx.teacherCourse.createMany({ data: courses.ids.map((courseId) => ({ teacherId: id, courseId })) });
    }
    return result;
    });
  } catch (error) {
    if (duplicate(error)) return { ok: false, fieldErrors: { teacherNo: "这个编号在本机构已经存在。" } };
    throw error;
  }
  if (updated.count !== 1) return { ok: false, message: "找不到这位教师，或你无权修改。" };

  refreshTeachers();
  return { ok: true };
}

export async function linkTeacherAccount(id: string): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  const existing = await prisma.teacher.findFirst({
    where: { id, organizationId: user.organizationId },
    select: { id: true, accountUserId: true },
  });
  if (!existing) return { ok: false, message: "找不到这位教师，或你无权修改。" };
  if (!existing.accountUserId) return { ok: false, fieldErrors: { link: "这位老师还没有注册。请先生成邀请码。" } };

  const account = await prisma.user.findFirst({
    where: { id: existing.accountUserId, organizationId: user.organizationId, roles: { has: "TEACHER" } },
    select: { id: true },
  });
  if (!account) return { ok: false, fieldErrors: { link: "这位老师的登录账号已不在本机构。" } };
  const taken = await prisma.teacher.findFirst({
    where: { userId: account.id, NOT: { id } },
    select: { id: true },
  });
  if (taken) return { ok: false, fieldErrors: { link: "这个登录账号已经关联了其他教师。" } };

  try {
    const result = await prisma.teacher.updateMany({
      where: { id, organizationId: user.organizationId, userId: null },
      data: { userId: account.id },
    });
    if (result.count !== 1) {
      const linked = await prisma.teacher.findFirst({
        where: { id, organizationId: user.organizationId, userId: account.id },
        select: { id: true },
      });
      if (!linked) return { ok: false, fieldErrors: { link: "关联没有完成。请刷新后再试。" } };
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, fieldErrors: { link: "这个登录账号已经关联了其他教师。" } };
    }
    throw error;
  }
  refreshTeachers();
  return { ok: true };
}

export async function revokeTeacherLogin(id: string): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  const existing = await prisma.teacher.findFirst({
    where: { id, organizationId: user.organizationId },
    select: { id: true, userId: true },
  });
  if (!existing) return { ok: false, message: "找不到这位教师，或你无权修改。" };
  if (!existing.userId) return { ok: false, message: "这位老师当前没有关联账号。" };

  const result = await prisma.teacher.updateMany({
    where: { id, organizationId: user.organizationId },
    data: { userId: null },
  });
  if (result.count !== 1) return { ok: false, message: "找不到这位教师，或你无权修改。" };

  refreshTeachers();
  return { ok: true, message: "已收回。这位老师暂时不能进入课表，密码没有改变。" };
}

export async function setTeacherStatus(id: string, status: MemberStatus): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  if (status !== "ACTIVE" && status !== "INACTIVE") return { ok: false, message: "状态无效。" };

  const teacher = await prisma.teacher.findFirst({
    where: { id, organizationId: user.organizationId },
    select: { id: true, name: true },
  });
  if (!teacher) return { ok: false, message: "找不到这位教师，或你无权修改。" };

  if (status === "INACTIVE") {
    const now = new Date();
    const [futureCount, samples] = await Promise.all([
      prisma.lessonSession.count({
        where: { organizationId: user.organizationId, teacherId: teacher.id, status: { not: "CANCELLED" }, startAt: { gt: now } },
      }),
      prisma.lessonSession.findMany({
        where: { organizationId: user.organizationId, teacherId: teacher.id, status: { not: "CANCELLED" }, startAt: { gt: now } },
        orderBy: { startAt: "asc" },
        take: 5,
        select: { title: true, startAt: true },
      }),
    ]);
    if (futureCount > 0) {
      const listed = samples
        .map((lesson) => `${lesson.title ?? "课次"}（${lesson.startAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hourCycle: "h23" })}）`)
        .join("；");
      const more = futureCount > samples.length ? `；另有 ${futureCount - samples.length} 节` : "";
      return {
        ok: false,
        message: `「${teacher.name}」还有 ${futureCount} 节未开始的课：${listed}${more}。请先在课表里更换授课教师，再停用。`,
      };
    }
  }

  const result = await prisma.teacher.updateMany({
    where: { id: teacher.id, organizationId: user.organizationId },
    data: { status },
  });
  if (result.count !== 1) return { ok: false, message: "找不到这位教师，或你无权修改。" };

  revalidatePath("/owner/teachers");
  revalidatePath("/owner/schedule");
  return { ok: true, message: status === "INACTIVE" ? "教师已停用。档案保留，新排课不能再选这位老师。" : "教师已恢复在职。" };
}
