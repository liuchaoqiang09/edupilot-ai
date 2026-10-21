"use server";

import { revalidatePath } from "next/cache";
import { BillingType, CourseCategory } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type FieldErrors = Partial<Record<"name" | "description" | "capacity" | "courseId" | "teacherId" | "billingType", string>>;

export type ActionResult = {
  ok: boolean;
  message?: string;
  fieldErrors?: FieldErrors;
};

const categories = new Set<CourseCategory>(["ACADEMIC", "ART", "EARLY_CHILDHOOD", "OTHER"]);
const billingTypes = new Set<BillingType>(["PER_LESSON", "PER_PERIOD"]);

function billingTypeOf(value: string): BillingType | null {
  return billingTypes.has(value as BillingType) ? (value as BillingType) : null;
}

function clean(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

export async function createCourse(formData: FormData): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  const fieldErrors: FieldErrors = {};
  const name = clean(formData.get("name"));
  const description = clean(formData.get("description"));
  const categoryValue = clean(formData.get("category"));
  const billingType = billingTypeOf(clean(formData.get("billingType")));

  if (!name) fieldErrors.name = "请填写课程名称。";
  else if (name.length > 40) fieldErrors.name = "课程名称不能超过 40 个字。";
  if (description.length > 200) fieldErrors.description = "描述不能超过 200 个字。";
  if (categoryValue && !categories.has(categoryValue as CourseCategory)) fieldErrors.name = "课程类别无效。";
  if (!billingType) fieldErrors.billingType = "请选择计费模式。";
  if (!billingType || Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  await prisma.course.create({
    data: {
      organizationId: user.organizationId,
      name,
      description: description || null,
      category: categoryValue ? (categoryValue as CourseCategory) : null,
      billingType,
    },
  });
  revalidatePath("/owner/courses");
  return { ok: true };
}

export async function updateCourse(formData: FormData): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  const fieldErrors: FieldErrors = {};
  const id = clean(formData.get("id"));
  const name = clean(formData.get("name"));
  const description = clean(formData.get("description"));
  const categoryValue = clean(formData.get("category"));
  const billingType = billingTypeOf(clean(formData.get("billingType")));

  if (!name) fieldErrors.name = "请填写课程名称。";
  else if (name.length > 40) fieldErrors.name = "课程名称不能超过 40 个字。";
  if (description.length > 200) fieldErrors.description = "描述不能超过 200 个字。";
  if (categoryValue && !categories.has(categoryValue as CourseCategory)) fieldErrors.name = "课程类别无效。";
  if (!billingType) fieldErrors.billingType = "请选择计费模式。";
  if (!billingType || Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  const existing = await prisma.course.findFirst({
    where: { id, organizationId: user.organizationId },
    select: { billingType: true },
  });
  if (!existing) return { ok: false, message: "找不到这门课程，或你无权修改。" };
  if (existing.billingType !== billingType) {
    const [enrollments, balances, charged] = await Promise.all([
      prisma.enrollment.count({ where: { courseId: id, organizationId: user.organizationId } }),
      prisma.courseHourBalance.count({ where: { courseId: id, organizationId: user.organizationId } }),
      prisma.lessonStudent.count({
        where: { organizationId: user.organizationId, hoursCharged: true, lessonSession: { courseId: id, organizationId: user.organizationId } },
      }),
    ]);
    if (enrollments + balances + charged > 0) {
      return { ok: false, fieldErrors: { billingType: "这门课已有报名或课时记录，不能更改计费模式。" } };
    }
  }

  const updated = await prisma.course.updateMany({
    where: { id, organizationId: user.organizationId },
    data: {
      name,
      description: description || null,
      category: categoryValue ? (categoryValue as CourseCategory) : null,
      billingType,
    },
  });
  if (updated.count !== 1) return { ok: false, message: "找不到这门课程，或你无权修改。" };
  revalidatePath("/owner/courses");
  revalidatePath("/owner/billing");
  return { ok: true };
}

export async function createClassGroup(formData: FormData): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  const fieldErrors: FieldErrors = {};
  const name = clean(formData.get("name"));
  const courseId = clean(formData.get("courseId"));
  const teacherId = clean(formData.get("teacherId"));
  const capacityText = clean(formData.get("capacity"));

  if (!name) fieldErrors.name = "请填写班级名称。";
  else if (name.length > 40) fieldErrors.name = "班级名称不能超过 40 个字。";
  if (!courseId) fieldErrors.courseId = "请选择所属课程。";
  if (!teacherId) fieldErrors.teacherId = "请选择主讲教师。";

  let capacity: number | null = null;
  if (capacityText) {
    const parsed = Number(capacityText);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) fieldErrors.capacity = "容量请填写 1 到 500 的整数。";
    else capacity = parsed;
  }
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  const [course, teacher] = await Promise.all([
    prisma.course.findFirst({ where: { id: courseId, organizationId: user.organizationId, status: "ACTIVE" }, select: { id: true } }),
    prisma.teacher.findFirst({ where: { id: teacherId, organizationId: user.organizationId, status: "ACTIVE" }, select: { id: true } }),
  ]);
  if (!course) fieldErrors.courseId = "所选课程不存在，或不属于当前机构。";
  if (!teacher) fieldErrors.teacherId = "所选教师不存在，或不属于当前机构。";
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  await prisma.classGroup.create({
    data: {
      organizationId: user.organizationId,
      name,
      courseId,
      teacherId,
      capacity,
    },
  });
  revalidatePath("/owner/courses");
  return { ok: true };
}

export async function archiveCourse(id: string): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  const result = await prisma.course.updateMany({
    where: { id, organizationId: user.organizationId, status: "ACTIVE" },
    data: { status: "ARCHIVED" },
  });
  if (result.count !== 1) return { ok: false, message: "找不到这门课程，或你无权修改。" };
  revalidatePath("/owner/courses");
  return { ok: true };
}

export async function archiveClassGroup(id: string): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  const result = await prisma.classGroup.updateMany({
    where: { id, organizationId: user.organizationId, status: "ACTIVE" },
    data: { status: "ARCHIVED" },
  });
  if (result.count !== 1) return { ok: false, message: "找不到这个班级，或你无权修改。" };
  revalidatePath("/owner/courses");
  return { ok: true };
}
