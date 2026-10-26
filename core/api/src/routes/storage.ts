import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { StorageManager } from '../services/storageManager.js';

export function registerStorageRoutes(
  app: FastifyInstance,
  deps: {
    storageManager: StorageManager;
    authMiddleware?: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  },
): void {
  const auth = deps.authMiddleware ? { preHandler: deps.authMiddleware } : {};
  // Get current storage usage
  app.get('/storage/usage', auth, async () => {
    const usage = await deps.storageManager.getStorageUsage();
    return usage;
  });
  
  // Trigger manual cleanup of orphaned files. Safe for any authenticated
  // user: it only deletes files that have no DB row at all.
  app.post('/storage/cleanup', auth, async () => {
    const cleaned = await deps.storageManager.cleanupOrphanedFiles();
    return { success: true, cleaned };
  });

  // NOTE: the former POST /storage/enforce-quota endpoint was removed —
  // enforceStorageQuota → cleanupLRU deletes real video rows+files across
  // ALL users, so any authenticated user could evict someone else's
  // uploads. Re-mount only behind an admin/owner role when one exists;
  // the service method remains available for internal/janitorial use.
}