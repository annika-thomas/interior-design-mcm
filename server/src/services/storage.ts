import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
};

export function storeUpload(buffer: Buffer, mime: string, originalName: string): string {
  const ext = EXT_BY_MIME[mime] ?? path.extname(originalName) ?? '';
  const filename = `${randomUUID()}${ext}`;
  fs.mkdirSync(config.uploadsDir, { recursive: true });
  fs.writeFileSync(path.join(config.uploadsDir, filename), buffer);
  return filename;
}

export function uploadPath(filename: string): string {
  // Guard against a stored filename escaping the uploads directory.
  const resolved = path.resolve(config.uploadsDir, filename);
  if (!resolved.startsWith(path.resolve(config.uploadsDir) + path.sep)) {
    throw new Error('Invalid upload path');
  }
  return resolved;
}

export function readUpload(filename: string): Buffer | null {
  try {
    return fs.readFileSync(uploadPath(filename));
  } catch {
    return null;
  }
}

export function deleteUpload(filename: string): void {
  try {
    fs.unlinkSync(uploadPath(filename));
  } catch { /* already gone */ }
}

export function readUploadBase64(filename: string): string | null {
  return readUpload(filename)?.toString('base64') ?? null;
}
