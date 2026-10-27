"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function markNoticesRead() {
  const user = await requireRole("PARENT", "parent");
  await prisma.parentNotice.updateMany({
    where: { organizationId: user.organizationId, parentUserId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/parent");
  revalidatePath("/parent/notices");
}
