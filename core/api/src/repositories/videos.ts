import type { VideoRow } from '@social-auto/shared';
import type { DB } from '../db.js';
import { randomUUID } from 'node:crypto';

export interface NewVideo {
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
    file_path: row[1] as string,
    sha256: row[2] as string,
    size_bytes: row[3] as number,
    duration_sec: (row[4] as number | null) ?? null,
    mime: row[5] as string,
    thumbnail_path: (row[6] as string | null) ?? null,
    created_at: row[7] as number,
  };
}

export class VideosRepo {
  constructor(private db: DB) {}

  insert(input: NewVideo): VideoRow {
    const row: VideoRow = {
      id: randomUUID(),
      file_path: input.file_path,
      sha256: input.sha256,
      size_bytes: input.size_bytes,
      duration_sec: input.duration_sec ?? null,
      mime: input.mime,
      thumbnail_path: input.thumbnail_path ?? null,
      created_at: Date.now(),
    };
    this.db.raw.run(
      `INSERT INTO videos (id, file_path, sha256, size_bytes, duration_sec, mime, thumbnail_path, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
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

  findBySha256(sha256: string): VideoRow | null {
    const result = this.db.raw.exec('SELECT * FROM videos WHERE sha256 = ? LIMIT 1', [sha256]);
    const first = result[0]?.values[0];
    return first ? rowToVideo(first) : null;
  }

  list(limit = 100): VideoRow[] {
    const result = this.db.raw.exec('SELECT * FROM videos ORDER BY created_at DESC LIMIT ?', [
      limit,
    ]);
    return (result[0]?.values ?? []).map(rowToVideo);
  }

  delete(id: string): void {
    this.db.raw.exec('DELETE FROM videos WHERE id = ?', [id]);
  }
}
