"use server";

import { revalidatePath } from "next/cache";
import { CourseCategory } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type SettingsResult = { ok: boolean; message?: string };

const languages = new Set(["zh-CN", "en"]);
const categories = new Set<CourseCategory>(["ACADEMIC", "ART", "EARLY_CHILDHOOD"]);

function checked(formData: FormData, name: string) {
  return formData.get(name) === "on";
}

export async function saveOrganizationSettings(formData: FormData): Promise<SettingsResult> {
  const user = await requireRole("OWNER", "owner");
  const name = typeof formData.get("name") === "string" ? formData.get("name")!.toString().trim() : "";
  const reportLanguage = typeof formData.get("reportLanguage") === "string" ? formData.get("reportLanguage")!.toString() : "";
  const businessTypes = [...new Set(formData.getAll("businessTypes").filter((value): value is string => typeof value === "string"))]
    .filter((value): value is CourseCategory => categories.has(value as CourseCategory));

  if (name.length < 2 || name.length > 40) return { ok: false, message: "机构名称需要 2 到 40 个字。" };
  if (!languages.has(reportLanguage)) return { ok: false, message: "请选择报告语言。" };
  if (businessTypes.length === 0) return { ok: false, message: "请至少选择一种业务类型。" };

  const updated = await prisma.organization.updateMany({
    where: { id: user.organizationId },
    data: {
      name,
      reportLanguage,
      businessTypes,
      aiUseRecentSummaries: checked(formData, "aiUseRecentSummaries"),
      aiRequireEvidence: checked(formData, "aiRequireEvidence"),
      aiTeacherMustConfirm: checked(formData, "aiTeacherMustConfirm"),
      aiOwnerSpotCheck: checked(formData, "aiOwnerSpotCheck"),
    },
  });
  if (updated.count !== 1) return { ok: false, message: "没有找到当前机构。" };

  revalidatePath("/owner/settings");
  revalidatePath("/owner");
  return { ok: true };
}
