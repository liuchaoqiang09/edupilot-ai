import { prisma } from "@/lib/prisma";

/** 家长端可见名单：在读孩子的全部课次，以及已停用孩子已经上过的课。 */
export function parentVisibleLessonFilter(now = new Date()) {
  return {
    OR: [
      { student: { status: "ACTIVE" as const } },
      { lessonSession: { startAt: { lte: now } } },
    ],
  };
}

/** 只允许跳到家长工作台内的路径，并去掉 ../、协议相对地址一类穿越。 */
export function safeParentHref(href: string, fallback = "/parent/notices") {
  const raw = href.trim();
  if (!raw.startsWith("/parent/")) return fallback;
  if (raw.startsWith("//") || raw.includes("\\") || raw.includes("@")) return fallback;
  try {
    const url = new URL(raw, "https://edupilot.local");
    if (url.origin !== "https://edupilot.local") return fallback;
    if (!url.pathname.startsWith("/parent/")) return fallback;
    if (url.pathname.split("/").includes("..")) return fallback;
    return `${url.pathname}${url.search}`;
  } catch {
    return fallback;
  }
}

export async function linkedParentChildren(organizationId: string, parentUserId: string) {
  const links = await prisma.parentStudentLink.findMany({
    where: { organizationId, parentUserId },
    select: {
      studentId: true,
      student: { select: { id: true, name: true, status: true } },
    },
    orderBy: { student: { name: "asc" } },
  });
  return links.map((link) => link.student);
}

/** 只接受已绑定孩子的 id；伪造的 studentId 一律忽略。 */
export function pickLinkedChildId(children: { id: string }[], requested: string | undefined | null) {
  const id = typeof requested === "string" ? requested.trim() : "";
  if (!id) return "";
  return children.some((child) => child.id === id) ? id : "";
}
