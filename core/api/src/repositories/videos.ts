import type { VideoRow } from '@social-auto/shared';
import type { DB } from '../db.js';
import { randomUUID } from 'node:crypto';

export interface NewVideo {
  user_id?: string;
  file_path: string;
  sha256: string;
  size_bytes: number;
  mime: string;
  duration_sec?: number | null;
  thumbnail_path?: string | null;
}

function rowToVideo(row: unknown[]): VideoRow {
  return {
    id: row[0] as string,
    user_id: row[1] as string,
    file_path: row[2] as string,
    sha256: row[3] as string,
    size_bytes: row[4] as number,
    duration_sec: (row[5] as number | null) ?? null,
    mime: row[6] as string,
    thumbnail_path: (row[7] as string | null) ?? null,
    created_at: row[8] as number,
  };
}

export class VideosRepo {
  constructor(private db: DB) {}

  insert(input: NewVideo): VideoRow {
    const row: VideoRow = {
      id: randomUUID(),
      user_id: input.user_id ?? 'default-user',
      file_path: input.file_path,
      sha256: input.sha256,
      size_bytes: input.size_bytes,
      duration_sec: input.duration_sec ?? null,
      mime: input.mime,
      thumbnail_path: input.thumbnail_path ?? null,
      created_at: Date.now(),
    };
    this.db.raw.run(
      `INSERT INTO videos (id, user_id, file_path, sha256, size_bytes, duration_sec, mime, thumbnail_path, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.user_id,
        row.file_path,
        row.sha256,
        row.size_bytes,
        row.duration_sec,
        row.mime,
        row.thumbnail_path,
        row.created_at,
      ],
    );
    return row;
  }

  findById(id: string): VideoRow | null {
    const result = this.db.raw.exec('SELECT * FROM videos WHERE id = ?', [id]);
    const first = result[0]?.values[0];
    return first ? rowToVideo(first) : null;
  }

  findBySha256(sha256: string, userId?: string): VideoRow | null {
    // Dedup is per-user: two different users uploading the same file get
    // separate rows (the on-disk file is shared via the sha256 filename),
    // otherwise user B's upload would return a row owned by user A that B
    // could never schedule or see.
    const sql = userId
      ? 'SELECT * FROM videos WHERE sha256 = ? AND user_id = ? LIMIT 1'
      : 'SELECT * FROM videos WHERE sha256 = ? LIMIT 1';
    const params = userId ? [sha256, userId] : [sha256];
    const result = this.db.raw.exec(sql, params);
    const first = result[0]?.values[0];
    return first ? rowToVideo(first) : null;
  }

  list(limit = 100, userId?: string): VideoRow[] {
    if (userId) {
      const result = this.db.raw.exec(
        'SELECT * FROM videos WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
        [userId, limit],
      );
      return (result[0]?.values ?? []).map(rowToVideo);
    }
    const result = this.db.raw.exec('SELECT * FROM videos ORDER BY created_at DESC LIMIT ?', [
      limit,
    ]);
    return (result[0]?.values ?? []).map(rowToVideo);
  }

  /** How many video rows point at the same file (same content hash). */
  countBySha256(sha256: string): number {
    const result = this.db.raw.exec('SELECT COUNT(*) FROM videos WHERE sha256 = ?', [sha256]);
    return (result[0]?.values[0]?.[0] as number) ?? 0;
  }

  delete(id: string): void {
    this.db.raw.run('DELETE FROM videos WHERE id = ?', [id]);
  }

  deleteByUserId(userId: string): void {
    this.db.raw.run('DELETE FROM videos WHERE user_id = ?', [userId]);
  }
}
