// Local disk storage for self-hosted deployments. Receipt bytes are always
// encrypted by the application before reaching storage.

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ENV } from "./_core/env";

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function safeLocalPath(relKey: string): string {
  const root = path.resolve(process.cwd(), ENV.storageDir);
  const target = path.resolve(root, normalizeKey(relKey));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid storage key");
  }
  return target;
}

function appendHashSuffix(relKey: string): string {
  const hash = randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

async function purgeEmptyDirs(filePath: string) {
  const root = path.resolve(process.cwd(), ENV.storageDir);
  let current = path.dirname(filePath);
  while (current.startsWith(root) && current !== root) {
    try {
      await fs.rmdir(current);
    } catch {
      break;
    }
    current = path.dirname(current);
  }
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  _contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const key = appendHashSuffix(normalizeKey(relKey));
  const filePath = safeLocalPath(key);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const bytes =
    typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
  await fs.writeFile(filePath, bytes);
  return { key, url: `/local-storage/${key}` };
}

export async function storageRead(relKey: string): Promise<Buffer> {
  const key = normalizeKey(relKey);
  return fs.readFile(safeLocalPath(key));
}

export async function storageDelete(relKey: string): Promise<void> {
  const key = normalizeKey(relKey);
  const filePath = safeLocalPath(key);
  try {
    await fs.unlink(filePath);
    await purgeEmptyDirs(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
