import type { FastifyInstance } from 'fastify';
import { unlink } from 'node:fs/promises';
import type { VideosRepo } from '../repositories/videos.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

export interface UploadProgress {
  videoId: string;
  progress: number;
  timestamp: number;
  cancellable?: boolean;
}

// Progress tracking cache
export const progressCache = new Map<string, UploadProgress>();

// Track active uploads that can be cancelled
export const activeUploads = new Map<string, { abortController: AbortController; filePath: string; userId?: string }>();

export function updateProgress(videoId: string, progress: number): void {
  progressCache.set(videoId, {
    videoId,
    progress: Math.max(0, Math.min(100, progress)), // Clamp between 0-100
    timestamp: Date.now(),
    cancellable: activeUploads.has(videoId),
  });
}

export function getProgress(videoId: string): UploadProgress | undefined {
  const progress = progressCache.get(videoId);
  if (progress) {
    return {
      ...progress,
      cancellable: activeUploads.has(videoId),
    };
  }
  return undefined;
}
export function registerActiveUpload(videoId: string, abortController: AbortController, filePath: string, userId?: string): void {
  activeUploads.set(videoId, { abortController, filePath, userId });
}

export function cleanupOldProgress(): void {
  const now = Date.now();
  const maxAge = 3600000; // 1 hour
  
  for (const [id, progress] of progressCache) {
    if (now - progress.timestamp > maxAge) {
      progressCache.delete(id);
      activeUploads.delete(id);
    }
  }
}

export function registerUploadProgressRoutes(
  app: FastifyInstance,
  deps?: { authMiddleware?: any; videos?: VideosRepo },
): void {
  const auth = deps?.authMiddleware ? { preHandler: deps.authMiddleware } : {};
  // When a VideosRepo is wired in, every progress endpoint checks that the
  // caller owns the video — otherwise any authenticated user could read or
  // write another user's upload progress by guessing/learning the video id.
  const ownsVideo = (req: any): 'ok' | 'not_found' | 'forbidden' => {
    if (!deps?.videos) return 'ok';
    const video = deps.videos.findById(req.params.id);
    if (!video) return 'not_found';
    return video.user_id === (req as AuthenticatedRequest).userId ? 'ok' : 'forbidden';
  };
  const ownershipError = (reply: any, result: 'not_found' | 'forbidden') =>
    reply
      .code(result === 'not_found' ? 404 : 403)
      .send({ error: result === 'not_found' ? 'Video not found' : 'video_not_owned' });

  // Get current progress for a video
  app.get<{ Params: { id: string } }>('/videos/:id/progress', auth, async (req, reply) => {
    const own = ownsVideo(req);
    if (own !== 'ok') return ownershipError(reply, own);
    const progress = getProgress(req.params.id);
    
    if (!progress) {
      return reply.code(404).send({ error: 'No progress data found' });
    }
    
    return progress;
  });
  
  // Update progress (called by worker)
  app.post<{ Params: { id: string } }>('/videos/:id/progress', auth, async (req, reply) => {
    const own = ownsVideo(req);
    if (own !== 'ok') return ownershipError(reply, own);
    const { progress } = req.body as { progress: number };
    updateProgress(req.params.id, progress);
    return { success: true };
  });
  
  // Server-Sent Events endpoint for real-time progress
  app.get<{ Params: { id: string } }>('/videos/:id/progress/stream', auth, async (req, reply) => {
    const own = ownsVideo(req);
    if (own !== 'ok') return ownershipError(reply, own);
    const videoId = req.params.id;
    
    // Set up SSE
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    
    const sendProgress = () => {
      const progress = getProgress(videoId);
      if (progress) {
        reply.raw.write(`data: ${JSON.stringify(progress)}\n\n`);
      }
    };
    
    // Send initial progress
    sendProgress();
    
    // Send progress updates every second
    const interval = setInterval(() => {
      sendProgress();
    }, 1000);
    
    // Clean up on connection close
    req.raw.on('close', () => {
      clearInterval(interval);
    });
    
    // Clean up old progress entries periodically
    const cleanupInterval = setInterval(() => {
      cleanupOldProgress();
    }, 60000); // Every minute
    
    req.raw.on('close', () => {
      clearInterval(cleanupInterval);
    });
  });
  
  // Cleanup endpoint (for testing)
  app.delete<{ Params: { id: string } }>('/videos/:id/progress', auth, async (req, reply) => {
    const own = ownsVideo(req);
    if (own !== 'ok') return ownershipError(reply, own);
    progressCache.delete(req.params.id);
    return { success: true };
  });

  // Cancel active upload
  app.post<{ Params: { id: string } }>('/videos/:id/cancel', auth, async (req, reply) => {
    const { id } = req.params;
    const own = ownsVideo(req);
    const activeUpload = activeUploads.get(id);
    if (own !== 'ok' && activeUpload?.userId !== (req as AuthenticatedRequest).userId) {
      return ownershipError(reply, own);
    }
    
    if (!activeUpload) {
      return reply.code(404).send({ error: 'No active upload found for this video' });
    }
    
    try {
      // Abort the upload
      activeUpload.abortController.abort();
      
      // Clean up partial file if it exists
      try {
        await unlink(activeUpload.filePath);
      } catch (err) {
        // File might not exist yet or already deleted
        console.warn('Failed to delete partial file:', err);
      }
      
      // Remove from tracking
      activeUploads.delete(id);
      progressCache.delete(id);
      
      return reply.code(200).send({ success: true, message: 'Upload cancelled' });
    } catch (error) {
      console.error('Error cancelling upload:', error);
      return reply.code(500).send({ error: 'Failed to cancel upload' });
    }
  });
}