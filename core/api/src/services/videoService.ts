import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { VideosRepo } from '../repositories/videos.js';
import { detectRealFileType } from './fileTypeDetector.js';

const ACCEPTED_MIME = new Set(['video/mp4', 'video/quicktime', 'video/webm']);
const MAX_SIZE_BYTES = 2 * 1024 * 1024 * 1024;
const YOUTUBE_MAX_DURATION_SEC = 12 * 60 * 60; // 12 hours
const YOUTUBE_RECOMMENDED_DURATION_SEC = 15 * 60; // 15 minutes

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
  userId?: string,
  onProgress?: (bytes: number) => void,
): Promise<IngestResult> {
  if (!ACCEPTED_MIME.has(mime)) {
    throw new UploadError(415, `Unsupported mime type: ${mime}`);
  }

  await fs.mkdir(storageDir, { recursive: true });

  const hash = createHash('sha256');
  let size = 0;
  const chunks: Buffer[] = [];

  // Collect chunks and compute hash
  for await (const chunk of iter) {
    size += chunk.length;
    if (size > MAX_SIZE_BYTES) {
      throw new UploadError(413, `File exceeds ${MAX_SIZE_BYTES} bytes`);
    }
    hash.update(chunk);
    chunks.push(chunk);
    onProgress?.(size);
  }

  if (size === 0) {
    throw new UploadError(400, 'Empty upload');
  }

  const sha256 = hash.digest('hex');
  const fileBuffer = Buffer.concat(chunks);

  const existing = repo.findBySha256(sha256);
  if (existing) {
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
  const finalKey = path.join(storageDir, finalName);

  // Write to local storage
  await fs.writeFile(finalKey, fileBuffer);

  // Validate real file format using magic number detection
  try {
    const detectedFormat = await detectRealFileType(finalKey);
    if (detectedFormat !== ext.replace('.', '')) {
      console.warn(`File extension (${ext}) doesn't match detected format (${detectedFormat})`);
    }
  } catch (error) {
    console.warn('Magic number detection failed, accepting file based on MIME type:', error);
  }

  // Probe duration
  const duration = await probeDuration(finalKey).catch(() => null);

  // Validate duration against YouTube limits (warning only, not rejection)
  if (duration !== null) {
    if (duration > YOUTUBE_MAX_DURATION_SEC) {
      console.warn(`Video duration ${formatDuration(duration)} exceeds YouTube maximum of 12 hours. Upload will proceed but may fail on YouTube.`);
    }

    if (duration > YOUTUBE_RECOMMENDED_DURATION_SEC) {
      console.warn(`Video duration ${formatDuration(duration)} exceeds YouTube recommended 15 minutes. Long videos may have processing delays.`);
    }
  }

  // Generate thumbnail
  let thumbnailPath: string | null = null;
  if (duration !== null) {
    const thumbName = `${sha256}.jpg`;
    const thumbPath = path.join(storageDir, thumbName);
    await generateThumbnail(finalKey, thumbPath, duration).catch(() => null);
    thumbnailPath = fileExists(thumbPath) ? thumbPath : null;
  }

  const row = repo.insert({
    user_id: userId,
    file_path: finalKey,
    sha256,
    size_bytes: size,
    mime,
    duration_sec: duration,
    thumbnail_path: thumbnailPath,
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

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
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
