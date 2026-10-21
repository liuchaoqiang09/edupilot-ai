"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type ActionResult = { ok: boolean; message?: string };

export async function linkParent(studentId: string, parentUserId: string): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  if (!studentId || !parentUserId) return { ok: false, message: "请选择家长账号。" };

  const [student, parent] = await Promise.all([
    prisma.student.findFirst({
      where: { id: studentId, organizationId: user.organizationId },
      select: { id: true },
    }),
    prisma.user.findFirst({
      where: { id: parentUserId, organizationId: user.organizationId, roles: { has: "PARENT" } },
      select: { id: true },
    }),
  ]);
  if (!student) return { ok: false, message: "找不到这名学生，或你无权修改。" };
  if (!parent) return { ok: false, message: "只能绑定本机构里拥有家长角色的账号。" };

  try {
    await prisma.parentStudentLink.create({
      data: {
        organizationId: user.organizationId,
        studentId: student.id,
        parentUserId: parent.id,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, message: "这位家长已经绑定了这名学生。" };
    }
    throw error;
  }

  revalidatePath("/owner/students");
  revalidatePath("/parent");
  return { ok: true };
}

export async function unlinkParent(linkId: string): Promise<ActionResult> {
  const user = await requireRole("OWNER", "owner");
  const result = await prisma.parentStudentLink.deleteMany({
    where: { id: linkId, organizationId: user.organizationId },
  });
  if (result.count !== 1) return { ok: false, message: "找不到这条绑定，或你无权解除。" };
  revalidatePath("/owner/students");
  revalidatePath("/parent");
  return { ok: true };
}
