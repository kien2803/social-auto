import { createHash } from 'node:crypto';
import { createWriteStream, statSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { VideosRepo } from '../repositories/videos.js';

const ACCEPTED_MIME = new Set(['video/mp4', 'video/quicktime', 'video/webm']);
const MAX_SIZE_BYTES = 2 * 1024 * 1024 * 1024;

export interface IngestResult {
  video_id: string;
  sha256: string;
  size_bytes: number;
  duration_sec: number | null;
  mime: string;
  thumbnail_path: string | null;
  deduped: boolean;
}

/**
 * Stream an upload to disk while computing sha256, then probe duration + generate
 * a thumbnail. Returns a row id; deduplicates by sha256 so two identical uploads
 * share storage.
 */
export async function ingestUpload(
  repo: VideosRepo,
  storageDir: string,
  iter: AsyncIterable<Buffer>,
  mime: string,
  originalFilename: string,
  onProgress?: (bytes: number) => void,
): Promise<IngestResult> {
  if (!ACCEPTED_MIME.has(mime)) {
    throw new UploadError(415, `Unsupported mime type: ${mime}`);
  }

  await fs.mkdir(storageDir, { recursive: true });

  const tmpName = `upload-${Date.now()}-${randomString(8)}`;
  const tmpPath = path.join(storageDir, tmpName);
  const hash = createHash('sha256');
  let size = 0;

  try {
    const out = createWriteStream(tmpPath);
    for await (const chunk of iter) {
      size += chunk.length;
      if (size > MAX_SIZE_BYTES) {
        out.destroy();
        await fs.unlink(tmpPath).catch(() => {});
        throw new UploadError(413, `File exceeds ${MAX_SIZE_BYTES} bytes`);
      }
      hash.update(chunk);
      onProgress?.(size);
      if (!out.write(chunk)) {
        const { promise, resolve } = Promise.withResolvers<void>();
        out.once('drain', () => resolve());
        await promise;
      }
    }
    const closed = Promise.withResolvers<void>();
    out.end((err: Error | null | undefined) => (err ? closed.reject(err) : closed.resolve()));
    await closed.promise;
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }

  if (size === 0) {
    await fs.unlink(tmpPath).catch(() => {});
    throw new UploadError(400, 'Empty upload');
  }

  const sha256 = hash.digest('hex');

  const existing = repo.findBySha256(sha256);
  if (existing) {
    await fs.unlink(tmpPath).catch(() => {});
    return {
      video_id: existing.id,
      sha256,
      size_bytes: existing.size_bytes,
      duration_sec: existing.duration_sec,
      mime: existing.mime,
      thumbnail_path: existing.thumbnail_path,
      deduped: true,
    };
  }

  const ext = path.extname(originalFilename).toLowerCase() || extForMime(mime);
  const finalName = `${sha256}${ext}`;
  const finalPath = path.join(storageDir, finalName);
  await fs.rename(tmpPath, finalPath);

  const duration = await probeDuration(finalPath).catch(() => null);

  const thumbName = `${sha256}.jpg`;
  const thumbPath = path.join(storageDir, thumbName);
  await generateThumbnail(finalPath, thumbPath, duration ?? 1).catch(() => null);

  const row = repo.insert({
    file_path: finalPath,
    sha256,
    size_bytes: size,
    mime,
    duration_sec: duration,
    thumbnail_path: fileExists(thumbPath) ? thumbPath : null,
  });

  return {
    video_id: row.id,
    sha256,
    size_bytes: row.size_bytes,
    duration_sec: row.duration_sec,
    mime: row.mime,
    thumbnail_path: row.thumbnail_path,
    deduped: false,
  };
}

function fileExists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

function extForMime(mime: string): string {
  switch (mime) {
    case 'video/mp4':
      return '.mp4';
    case 'video/quicktime':
      return '.mov';
    case 'video/webm':
      return '.webm';
    default:
      return '';
  }
}

function randomString(len: number): string {
  return Math.random().toString(36).slice(2, 2 + len);
}

function probeDuration(filePath: string): Promise<number | null> {
  const { promise, resolve } = Promise.withResolvers<number | null>();
  const proc = spawn('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  let out = '';
  proc.stdout.on('data', (d: Buffer) => (out += d.toString()));
  proc.on('close', (code) => {
    if (code !== 0) return resolve(null);
    const sec = parseFloat(out.trim());
    resolve(Number.isFinite(sec) ? Math.round(sec) : null);
  });
  proc.on('error', () => resolve(null));
  return promise;
}

function generateThumbnail(srcPath: string, outPath: string, seekSec: number): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const proc = spawn('ffmpeg', [
    '-y',
    '-ss', String(Math.max(0, Math.min(seekSec, 10))),
    '-i', srcPath,
    '-frames:v', '1',
    '-q:v', '3',
    outPath,
  ]);
  proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  proc.on('error', reject);
  return promise;
}

export class UploadError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const ACCEPTED_VIDEO_MIME = ACCEPTED_MIME;
export const MAX_VIDEO_SIZE = MAX_SIZE_BYTES;
