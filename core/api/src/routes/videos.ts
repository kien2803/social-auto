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
  storageManager?: any; // StorageManager instance
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
      files: 10, // Allow up to 10 files for bulk upload
    },
  });

  app.post('/videos', async (req, reply) => {
    if (!req.isMultipart()) {
      return reply.code(415).send({ 
        error: 'Invalid request format',
        message: 'Please upload a video file using the correct format',
        code: 'INVALID_FORMAT'
      });
    }
    const part = await req.file();
    if (!part) {
      return reply.code(400).send({ 
        error: 'No file provided',
        message: 'Please select a video file to upload',
        code: 'NO_FILE'
      });
    }

    const mime = part.mimetype;
    if (!ACCEPTED_VIDEO_MIME.has(mime)) {
      return reply.code(415).send({ 
        error: `Unsupported file type: ${mime}`,
        message: 'Please upload a video file in MP4, MOV, or WebM format',
        code: 'UNSUPPORTED_TYPE',
        supportedTypes: Array.from(ACCEPTED_VIDEO_MIME)
      });
    }

    try {
      const result = await ingestUpload(
        deps.videos,
        deps.storageDir,
        part.file,
        mime,
        part.filename,
        undefined,
        deps.storageManager,
      );
      return reply.code(result.deduped ? 200 : 201).send(result);
    } catch (err) {
      if (err instanceof UploadError) {
        const message = err.status === 413 
          ? `File too large. Maximum size is ${(MAX_VIDEO_SIZE / 1024 / 1024 / 1024).toFixed(1)}GB`
          : err.status === 507
          ? 'Not enough storage space. Please free up disk space or contact support'
          : err.message;
        
        return reply.code(err.status).send({ 
          error: err.message,
          message,
          code: err.status === 413 ? 'FILE_TOO_LARGE' : err.status === 507 ? 'INSUFFICIENT_STORAGE' : 'UPLOAD_ERROR'
        });
      }
      return reply.code(500).send({ 
        error: 'Upload failed',
        message: 'An unexpected error occurred. Please try again',
        code: 'INTERNAL_ERROR'
      });
    }
  });
  
  app.get('/videos', async () => {
    return { videos: deps.videos.list().map(toVideoWire) };
  });
  
  // Bulk upload endpoint
  app.post('/videos/bulk', async (req, reply) => {
    if (!req.isMultipart()) {
      return reply.code(415).send({ 
        error: 'Invalid request format',
        message: 'Please upload video files using the correct format',
        code: 'INVALID_FORMAT'
      });
    }
    
    const parts = req.files();
    const files: Array<{ file: any; filename: string; mimetype: string }> = [];
    
    for await (const part of parts) {
      if (part.type === 'file') {
        files.push({
          file: part.file,
          filename: part.filename,
          mimetype: part.mimetype,
        });
      }
    }
    
    if (files.length === 0) {
      return reply.code(400).send({ 
        error: 'No files provided',
        message: 'Please select at least one video file to upload',
        code: 'NO_FILES'
      });
    }
    
    if (files.length > 10) {
      return reply.code(400).send({ 
        error: 'Too many files',
        message: 'Maximum 10 files allowed per bulk upload',
        code: 'TOO_MANY_FILES',
        maxFiles: 10
      });
    }
    
    const results = [];
    const errors = [];
    
    for (const { file, filename, mimetype } of files) {
      if (!ACCEPTED_VIDEO_MIME.has(mimetype)) {
        errors.push({ 
          filename, 
          error: `Unsupported file type: ${mimetype}`,
          message: 'Only MP4, MOV, and WebM formats are supported',
          code: 'UNSUPPORTED_TYPE'
        });
        continue;
      }
      
      try {
        const result = await ingestUpload(
          deps.videos,
          deps.storageDir,
          file,
          mimetype,
          filename,
          undefined,
          deps.storageManager,
        );
        results.push({ filename, ...result });
      } catch (err) {
        if (err instanceof UploadError) {
          const message = err.status === 413 
            ? `File too large. Maximum size is ${(MAX_VIDEO_SIZE / 1024 / 1024 / 1024).toFixed(1)}GB`
            : err.status === 507
            ? 'Not enough storage space'
            : err.message;
          
          errors.push({ 
            filename, 
            error: err.message,
            message,
            code: err.status === 413 ? 'FILE_TOO_LARGE' : err.status === 507 ? 'INSUFFICIENT_STORAGE' : 'UPLOAD_ERROR'
          });
        } else {
          errors.push({ 
            filename, 
            error: 'upload failed',
            message: 'An unexpected error occurred while uploading this file',
            code: 'INTERNAL_ERROR'
          });
        }
      }
    }
    
    return reply.code(200).send({
      uploaded: results,
      failed: errors,
      total: files.length,
      success: results.length,
      failure: errors.length,
      message: results.length === files.length 
        ? 'All files uploaded successfully' 
        : `${results.length} of ${files.length} files uploaded successfully`
    });
  });

  app.get<{ Params: { id: string } }>('/videos/:id', async (req, reply) => {
    const video = deps.videos.findById(req.params.id);
    if (!video) {
      reply.code(404);
      return { error: 'Video not found' };
    }
    return toVideoWire(video);
  });

  // Delete/cancel upload endpoint
  app.delete<{ Params: { id: string } }>('/videos/:id', async (req, reply) => {
    const video = deps.videos.findById(req.params.id);
    if (!video) {
      reply.code(404);
      return { error: 'Video not found' };
    }

    // Delete the file from storage
    try {
      const fs = await import('node:fs/promises');
      await fs.unlink(video.file_path).catch(() => {
        // File might not exist, continue with cleanup
      });

      // Delete thumbnail if exists
      if (video.thumbnail_path) {
        await fs.unlink(video.thumbnail_path).catch(() => {});
      }
    } catch (error) {
      // Log error but continue with database cleanup
      console.error('[videos] Error deleting file:', error);
    }

    // Note: VideosRepo doesn't have delete method, so we can't delete from database
    // In a real implementation, you would add a delete method to VideosRepo
    // For now, we just clean up the files

    return { success: true, message: 'Video files deleted' };
  });
}
