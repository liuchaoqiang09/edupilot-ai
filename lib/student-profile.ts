import { pick, type Locale } from "@/lib/locale";

export function parseMainlandPhone(value: string, required: boolean) {
  const phone = value.trim();
  if (!phone) return required ? { phone: null, error: "请填写联系人电话。" } : { phone: null as string | null };
  if (!/^1[3-9]\d{9}$/.test(phone)) return { phone: null, error: "联系人电话需要是 11 位中国大陆手机号。" };
  return { phone };
}

export function parseAge(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return { age: null as number | null };
  if (!/^\d+$/.test(text)) return { age: null, error: "年龄只能填写数字。" };
  const age = Number(text);
  if (age < 1 || age > 120) return { age: null, error: "年龄只能填写 1 到 120 的整数。" };
  return { age };
}

export function studentFacts(grade: string | null | undefined, age: number | null | undefined, locale: Locale = "zh-CN") {
  const gradeText = grade?.trim() || pick(locale, "未填年级", "Grade not set");
  const ageText = age ? pick(locale, `${age}岁`, `${age} years`) : pick(locale, "未填年龄", "Age not set");
  return `${gradeText} · ${ageText}`;
}

export const unenrolledBadgeClass = "bg-[#fdecec] text-[#b94d4d]";

export function studyBadge(status: "ACTIVE" | "INACTIVE", enrolled: boolean) {
  if (status !== "ACTIVE") return { label: "已停用", className: "bg-[#fff2df] text-[#9a6729]" };
  if (!enrolled) return { label: "未报名", className: unenrolledBadgeClass };
  return { label: "在读", className: "bg-[#edf5f1] text-[#34725d]" };
}
