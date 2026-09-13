import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import type { VideoRow } from '@social-auto/shared';
import type { VideosRepo } from '../repositories/videos.js';
import {
  ACCEPTED_VIDEO_MIME,
  MAX_VIDEO_SIZE,
  UploadError,
  ingestUpload,
} from '../services/videoService.js';

export interface VideosDeps {
  videos: VideosRepo;
  storageDir: string;
}

/** Wire shape returned to clients. Drops server-side filesystem paths. */
interface VideoWire {
  id: string;
  sha256: string;
  size_bytes: number;
  duration_sec: number | null;
  mime: string;
  filename: string;
  has_thumbnail: boolean;
  created_at: number;
}

function toVideoWire(row: VideoRow): VideoWire {
  return {
    id: row.id,
    sha256: row.sha256,
    size_bytes: row.size_bytes,
    duration_sec: row.duration_sec,
    mime: row.mime,
    // file_path / thumbnail_path are server-side storage locations and
    // must not leak to the API surface (they'd expose the storage layout
    // to anyone who can list videos). Surface the basename instead so
    // the UI can show "video.mp4" in the picker without seeing the
    // absolute path.
    filename: row.file_path.split(/[/\\]/).pop() ?? '',
    has_thumbnail: row.thumbnail_path !== null && row.thumbnail_path !== '',
    created_at: row.created_at,
  };
}

export function registerVideoRoutes(app: FastifyInstance, deps: VideosDeps): void {
  app.register(multipart, {
    limits: {
      fileSize: MAX_VIDEO_SIZE,
      files: 1,
    },
  });

  app.post('/videos', async (req, reply) => {
    if (!req.isMultipart()) {
      return reply.code(415).send({ error: 'expected multipart/form-data' });
    }
    const part = await req.file();
    if (!part) return reply.code(400).send({ error: 'no file part' });

    const mime = part.mimetype;
    if (!ACCEPTED_VIDEO_MIME.has(mime)) {
      return reply.code(415).send({ error: `unsupported mime: ${mime}` });
    }

    try {
      const result = await ingestUpload(
        deps.videos,
        deps.storageDir,
        part.file,
        mime,
        part.filename,
      );
      return reply.code(result.deduped ? 200 : 201).send(result);
    } catch (err) {
      if (err instanceof UploadError) {
        return reply.code(err.status).send({ error: err.message });
      }
      throw err;
    }
  });

  app.get('/videos', async () => {
    return { videos: deps.videos.list().map(toVideoWire) };
  });

  app.get<{ Params: { id: string } }>('/videos/:id', async (req, reply) => {
    const v = deps.videos.findById(req.params.id);
    if (!v) return reply.code(404).send({ error: 'not_found' });
    return toVideoWire(v);
  });
}
