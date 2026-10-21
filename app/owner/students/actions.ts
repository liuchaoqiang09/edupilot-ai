"use server";

import { revalidatePath } from "next/cache";
import { MemberStatus, Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type FieldErrors = Partial<Record<"name" | "studentNo" | "grade" | "contactNote", string>>;

export type ActionResult = {
  ok: boolean;
  message?: string;
  fieldErrors?: FieldErrors;
};

function clean(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function validateStudent(formData: FormData) {
  const fieldErrors: FieldErrors = {};
  const name = clean(formData.get("name"));
  const studentNo = clean(formData.get("studentNo"));
  const grade = clean(formData.get("grade"));
  const contactNote = clean(formData.get("contactNote"));

  if (!name) fieldErrors.name = "请填写学生姓名。";
  else if (name.length > 40) fieldErrors.name = "姓名不能超过 40 个字。";
  if (studentNo && !/^[A-Za-z0-9-]{1,32}$/.test(studentNo)) {
    fieldErrors.studentNo = "编号只能包含字母、数字和短横线，最多 32 位。";
  }
  if (grade.length > 40) fieldErrors.grade = "年级或年龄不能超过 40 个字。";
  if (contactNote.length > 200) fieldErrors.contactNote = "联系备注不能超过 200 个字。";

  return {
    fieldErrors,
    data: {
      name,
      studentNo: studentNo || null,
      grade: grade || null,
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
    data: { status },
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

  revalidatePath("/owner/students");
  return { ok: true };
}
