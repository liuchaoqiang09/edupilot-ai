import { mkdir, readFile, appendFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";

/**
 * 课次只在页面保留最近一年，用来控制数据库容量。
 * 超过一年的课次、考勤、课堂记录和教学报告先导出到 backups/。
 * 读回文件并核对条数之后，才删除这批已导出的记录。
 * 页面和接口不能调用这里。导出失败时保留数据库原样。
 */
export const LESSON_RETENTION_DAYS = 365;
const batchSize = 100;

type ArchiveDb = Pick<PrismaClient, "$transaction" | "lessonSession" | "lessonStudent" | "teachingRecord" | "teachingReport">;

export function retentionCutoff(now = new Date()) {
  return new Date(now.getTime() - LESSON_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

function csvCell(value: string | number | null | undefined) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function archiveLessonsOlderThan(db: ArchiveDb, cutoff: Date, directory: string, dryRun: boolean) {
  if (dryRun) {
    const exported = await db.lessonSession.count({ where: { startAt: { lt: cutoff } } });
    return { exported, removed: 0, jsonPath: null, csvPath: null, dryRun: true };
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const jsonPath = path.join(directory, `lesson-archive-${stamp}.jsonl`);
  const csvPath = path.join(directory, `lesson-archive-${stamp}.csv`);
  let exported = 0;
  let removed = 0;

  if (!dryRun) {
    await mkdir(directory, { recursive: true });
    await appendFile(csvPath, "\uFEFForganizationId,lessonId,startAt,endAt,title,location,status,studentName,attendanceStatus,attendanceNote\r\n", "utf8");
  }

  for (;;) {
    const lessons = await db.lessonSession.findMany({
      where: { startAt: { lt: cutoff } },
      orderBy: { startAt: "asc" },
      take: batchSize,
      include: {
        students: { include: { student: { select: { name: true } } } },
        teachingRecord: true,
        reports: true,
      },
    });
    if (lessons.length === 0) break;

    const jsonLines = lessons.map((lesson) => JSON.stringify(lesson)).join("\n") + "\n";
    const csvLines = lessons.flatMap((lesson) => {
      const rows = lesson.students.length > 0 ? lesson.students : [null];
      return rows.map((row) => [
        lesson.organizationId,
        lesson.id,
        lesson.startAt.toISOString(),
        lesson.endAt.toISOString(),
        lesson.title ?? "",
        lesson.location ?? "",
        lesson.status,
        row?.student.name ?? "",
        row?.attendanceStatus ?? "",
        row?.attendanceNote ?? "",
      ].map(csvCell).join(","));
    }).join("\r\n") + "\r\n";

    await appendFile(jsonPath, jsonLines, "utf8");
    await appendFile(csvPath, csvLines, "utf8");
    const written = (await readFile(jsonPath, "utf8")).trim().split("\n").filter(Boolean);
    const parsed = written.slice(-lessons.length).map((line) => JSON.parse(line) as { id: string });
    if (parsed.length !== lessons.length || parsed.some((row, index) => row.id !== lessons[index]?.id)) {
      throw new Error("导出文件核对失败，没有删除任何新的课次。");
    }

    const ids = lessons.map((lesson) => lesson.id);
    const deleted = await db.$transaction(async (tx) => {
      await tx.teachingReport.deleteMany({ where: { lessonSessionId: { in: ids }, lessonSession: { startAt: { lt: cutoff } } } });
      await tx.teachingRecord.deleteMany({ where: { lessonSessionId: { in: ids }, lessonSession: { startAt: { lt: cutoff } } } });
      await tx.lessonStudent.deleteMany({ where: { lessonSessionId: { in: ids }, lessonSession: { startAt: { lt: cutoff } } } });
      return tx.lessonSession.deleteMany({ where: { id: { in: ids }, startAt: { lt: cutoff } } });
    }, { timeout: 20000 });
    if (deleted.count !== lessons.length) throw new Error("清理条数和导出条数不一致，请先停止后续归档。");
    exported += lessons.length;
    removed += deleted.count;
  }

  return { exported, removed, jsonPath: dryRun ? null : jsonPath, csvPath: dryRun ? null : csvPath, dryRun };
}
