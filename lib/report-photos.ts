import { access, mkdir, readFile, unlink, writeFile } from "fs/promises";
import { join } from "path";

const types = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export function reportPhotoExt(contentType: string) {
  return types.get(contentType) ?? null;
}

export function reportPhotoFolder(organizationId?: string) {
  const root = join(process.cwd(), "uploads", "report-photos");
  if (!organizationId) return root;
  const safe = organizationId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "org";
  return join(root, safe);
}

export function reportPhotoPath(id: string, contentType: string, organizationId?: string) {
  const ext = reportPhotoExt(contentType) ?? "jpg";
  return join(reportPhotoFolder(organizationId), `${id}.${ext}`);
}

/** 优先读机构目录，兼容上线前落在扁平目录的旧文件。 */
export async function readReportPhotoBytes(id: string, contentType: string, organizationId: string) {
  const primary = reportPhotoPath(id, contentType, organizationId);
  try {
    await access(primary);
    return readFile(primary);
  } catch {
    return readFile(reportPhotoPath(id, contentType));
  }
}

export async function writeReportPhotoFile(organizationId: string, id: string, contentType: string, bytes: Buffer) {
  const ext = reportPhotoExt(contentType);
  if (!ext) throw new Error("unsupported-report-photo-type");
  const folder = reportPhotoFolder(organizationId);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, `${id}.${ext}`), bytes);
}

export async function removeReportPhotoFile(id: string, contentType: string, organizationId: string) {
  await unlink(reportPhotoPath(id, contentType, organizationId)).catch(() => undefined);
  await unlink(reportPhotoPath(id, contentType)).catch(() => undefined);
}
