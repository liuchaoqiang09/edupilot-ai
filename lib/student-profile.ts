export function parseAge(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return { age: null as number | null };
  if (!/^\d+$/.test(text)) return { age: null, error: "年龄只能填写数字。" };
  const age = Number(text);
  if (age < 1 || age > 120) return { age: null, error: "年龄只能填写 1 到 120 的整数。" };
  return { age };
}

export function studentFacts(grade: string | null | undefined, age: number | null | undefined) {
  return `${grade?.trim() || "未填年级"} · ${age ? `${age}岁` : "未填年龄"}`;
}

export const unenrolledBadgeClass = "bg-[#fdecec] text-[#b94d4d]";

export function studyBadge(status: "ACTIVE" | "INACTIVE", enrolled: boolean) {
  if (status !== "ACTIVE") return { label: "已停用", className: "bg-[#fff2df] text-[#9a6729]" };
  if (!enrolled) return { label: "未报名", className: unenrolledBadgeClass };
  return { label: "在读", className: "bg-[#edf5f1] text-[#34725d]" };
}
