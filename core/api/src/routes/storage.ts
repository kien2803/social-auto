import type { FastifyInstance } from 'fastify';
import type { StorageManager } from '../services/storageManager.js';

export function registerStorageRoutes(
  app: FastifyInstance,
  deps: {
    storageManager: StorageManager;
    authMiddleware?: any;
  },
): void {
  const auth = deps.authMiddleware ? { preHandler: deps.authMiddleware } : {};
  // Get current storage usage
  app.get('/storage/usage', auth, async () => {
    const usage = await deps.storageManager.getStorageUsage();
    return usage;
  });
  
  // Trigger manual cleanup
  app.post('/storage/cleanup', auth, async () => {
    const cleaned = await deps.storageManager.cleanupOrphanedFiles();
    return { success: true, cleaned };
  });
  
  // Enforce storage quota
  app.post('/storage/enforce-quota', auth, async () => {
    await deps.storageManager.enforceStorageQuota();
    const usage = await deps.storageManager.getStorageUsage();
    return { success: true, usage };
  });
}