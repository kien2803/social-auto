import type { FastifyInstance } from 'fastify';
import type { StorageManager } from '../services/storageManager.js';

export function registerStorageRoutes(app: FastifyInstance, deps: { storageManager: StorageManager }): void {
  // Get current storage usage
  app.get('/storage/usage', async () => {
    const usage = await deps.storageManager.getStorageUsage();
    return usage;
  });
  
  // Trigger manual cleanup
  app.post('/storage/cleanup', async () => {
    const cleaned = await deps.storageManager.cleanupOrphanedFiles();
    return { success: true, cleaned };
  });
  
  // Enforce storage quota
  app.post('/storage/enforce-quota', async () => {
    await deps.storageManager.enforceStorageQuota();
    const usage = await deps.storageManager.getStorageUsage();
    return { success: true, usage };
  });
}