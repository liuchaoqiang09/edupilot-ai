import { randomBytes } from "crypto";
import { mkdir, unlink, writeFile } from "fs/promises";
import { join } from "path";
import {
  HOMEWORK_MAX_FILE_BYTES,
  HOMEWORK_MAX_FILES,
  HOMEWORK_MAX_IMAGE_BYTES,
  HOMEWORK_MAX_IMAGES,
} from "@/lib/homework";

type HomeworkAssetKind = "IMAGE" | "FILE";

const imageByMime = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

const fileByMime = new Map([
  ["application/pdf", "pdf"],
  ["text/plain", "txt"],
  ["application/msword", "doc"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
]);

const mimeByExt = new Map([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
  ["pdf", "application/pdf"],
  ["txt", "text/plain"],
  ["doc", "application/msword"],
  ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
]);

export function homeworkAssetFolder(organizationId?: string) {
  const root = join(process.cwd(), "uploads", "homework-assets");
  if (!organizationId) return root;
  const safe = organizationId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "org";
  return join(root, safe);
}

export function homeworkAssetPath(id: string, contentType: string, organizationId?: string) {
  const ext = imageByMime.get(contentType) ?? fileByMime.get(contentType) ?? "bin";
  return join(homeworkAssetFolder(organizationId), `${id}.${ext}`);
}

function extensionOf(name: string) {
  const match = /\.([a-z0-9]+)$/i.exec(name.trim());
  return match ? match[1].toLowerCase() : "";
}

export function classifyHomeworkFile(file: File): { ok: true; kind: HomeworkAssetKind; ext: string; contentType: string } | { ok: false; message: string } {
  let contentType = file.type;
  let ext = imageByMime.get(contentType) ?? fileByMime.get(contentType) ?? "";
  if (!ext) {
    const byName = extensionOf(file.name);
    const mime = mimeByExt.get(byName === "jpeg" ? "jpg" : byName);
    if (mime) {
      contentType = mime;
      ext = imageByMime.get(mime) ?? fileByMime.get(mime) ?? byName;
    }
  }
  if (!ext) return { ok: false, message: "照片支持 JPG/PNG/WEBP；附件支持 PDF、TXT、DOC、DOCX。" };
  const kind: HomeworkAssetKind = imageByMime.has(contentType) ? "IMAGE" : "FILE";
  if (kind === "IMAGE" && file.size > HOMEWORK_MAX_IMAGE_BYTES) return { ok: false, message: "单张照片不能超过 2 MB。" };
  if (kind === "FILE" && file.size > HOMEWORK_MAX_FILE_BYTES) return { ok: false, message: "单个附件不能超过 5 MB。" };
  return { ok: true, kind, ext, contentType };
}

export function sanitizeFileName(name: string) {
  const trimmed = name.trim().replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80);
  return trimmed || "附件";
}

export async function writeHomeworkAssetFiles(
  organizationId: string,
  submissionId: string,
  files: File[],
  existing: { images: number; files: number },
) {
  void submissionId;
  let images = existing.images;
  let docs = existing.files;
  const created: { id: string; kind: HomeworkAssetKind; fileName: string; contentType: string; sizeBytes: number }[] = [];
  const folder = homeworkAssetFolder(organizationId);
  await mkdir(folder, { recursive: true });
  for (const file of files) {
    if (!(file instanceof File) || file.size === 0) continue;
    const typed = classifyHomeworkFile(file);
    if (!typed.ok) return { ok: false as const, message: typed.message, created };
    if (typed.kind === "IMAGE") {
      if (images >= HOMEWORK_MAX_IMAGES) return { ok: false as const, message: `最多 ${HOMEWORK_MAX_IMAGES} 张照片。`, created };
      images += 1;
    } else {
      if (docs >= HOMEWORK_MAX_FILES) return { ok: false as const, message: `最多 ${HOMEWORK_MAX_FILES} 个附件。`, created };
      docs += 1;
    }
    const id = randomBytes(16).toString("hex");
    await writeFile(join(folder, `${id}.${typed.ext}`), Buffer.from(await file.arrayBuffer()));
    created.push({
      id,
      kind: typed.kind,
      fileName: sanitizeFileName(file.name),
      contentType: typed.contentType,
      sizeBytes: file.size,
    });
  }
  return { ok: true as const, created, images, files: docs };
}

export async function removeHomeworkAssetFile(id: string, contentType: string, organizationId?: string) {
  await unlink(homeworkAssetPath(id, contentType, organizationId)).catch(() => undefined);
  if (organizationId) await unlink(homeworkAssetPath(id, contentType)).catch(() => undefined);
}
