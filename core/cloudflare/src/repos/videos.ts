import type { VideoRow } from './types';

export interface NewVideo {
  /** Pre-generated id — upload routes need it before insert to name the
   *  R2 key (videos/<user>/<id>/<filename>). */
  id?: string;
  user_id: string;
  file_path: string; // R2 object key in the CF deployment
  sha256: string;
  size_bytes: number;
  duration_sec?: number | null;
  mime: string;
  thumbnail_path?: string | null;
}

export class VideosRepo {
  constructor(private db: D1Database) {}

  async insert(input: NewVideo): Promise<VideoRow> {
    const id = input.id ?? crypto.randomUUID();
    const now = Date.now();
    await this.db
      .prepare(
        `INSERT INTO videos (id, user_id, file_path, sha256, size_bytes, duration_sec, mime, thumbnail_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, input.user_id, input.file_path, input.sha256, input.size_bytes,
        input.duration_sec ?? null, input.mime, input.thumbnail_path ?? null, now)
      .run();
    return (await this.findById(id))!;
  }

  async findById(id: string): Promise<VideoRow | null> {
    return this.db.prepare('SELECT * FROM videos WHERE id = ?').bind(id).first<VideoRow>();
  }

  async findBySha256(userId: string, sha256: string): Promise<VideoRow | null> {
    return this.db
      .prepare('SELECT * FROM videos WHERE user_id = ? AND sha256 = ?')
      .bind(userId, sha256)
      .first<VideoRow>();
  }

  /** Global count — deduped rows share one R2 object, so the object may
   *  only be deleted when this is the last row referencing it. */
  async countBySha256(sha256: string): Promise<number> {
    const r = await this.db
      .prepare('SELECT COUNT(*) AS n FROM videos WHERE sha256 = ?')
      .bind(sha256)
      .first<{ n: number }>();
    return r?.n ?? 0;
  }

  async setThumbnail(id: string, thumbnailPath: string): Promise<void> {
    await this.db
      .prepare('UPDATE videos SET thumbnail_path = ? WHERE id = ?')
      .bind(thumbnailPath, id)
      .run();
  }

  /** Sum of stored bytes for the storage-quota check. Deduped rows share
   *  bytes but still count — keeps the cap conservative and simple. */
  async storageUsedBytes(userId: string): Promise<number> {
    const r = await this.db
      .prepare('SELECT COALESCE(SUM(size_bytes), 0) AS n FROM videos WHERE user_id = ?')
      .bind(userId)
      .first<{ n: number }>();
    return r?.n ?? 0;
  }

  async list(userId?: string, limit = 100, offset = 0): Promise<VideoRow[]> {
    const q = userId
      ? this.db.prepare('SELECT * FROM videos WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').bind(userId, limit, offset)
      : this.db.prepare('SELECT * FROM videos ORDER BY created_at DESC LIMIT ? OFFSET ?').bind(limit, offset);
    return (await q.all<VideoRow>()).results;
  }

  async delete(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM videos WHERE id = ?').bind(id).run();
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.db.prepare('DELETE FROM videos WHERE user_id = ?').bind(userId).run();
  }
}
