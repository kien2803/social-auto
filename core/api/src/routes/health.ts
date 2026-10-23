import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ScheduledPostsRepo } from '../repositories/scheduledPosts.js';
import type { AccountsRepo } from '../repositories/accounts.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

export interface HealthDeps {
  posts: ScheduledPostsRepo;
  accounts: AccountsRepo;
  /** When present, authenticated callers additionally get the worker
   * rollup + per-account list. Anonymous callers (load balancers,
   * monitors) get only the minimal liveness payload — the account rollup
   * would otherwise expose every user's connected accounts. */
  optionalAuthMiddleware?: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

interface AccountHealth {
  id: string;
  platform: string;
  display_name: string;
  status: 'active' | 'expired' | 'revoked';
}

interface HealthResponse {
  status: 'ok';
  uptime_sec: number;
  timestamp: number;
  storage_dir: string;
  version: string;
  environment: string;
  worker?: {
    /** Always "ok" from the API's perspective — the worker reports by writing
     * to scheduled_posts. A user can tell the worker is alive by checking
     * whether `last_publish_at` is recent or whether the `next due` row is
     * `uploading` (claimed) rather than `pending` (waiting). */
    status: 'ok';
    /** ms epoch of the most recent successful publish. null if no post has
     * ever been published. */
    last_publish_at: number | null;
    /** Counts per status — mirror of /dashboard/counts but cheaper to grep
     * since health is called by monitors. */
    by_status: Record<string, number>;
  };
  accounts?: AccountHealth[];
}

/**
 * Phase 3 T3.6: GET /health — extended with worker status, account rollup,
 * and last_publish_at. The original /health shape (status, uptime_sec,
 * timestamp, storage_dir) is preserved; new fields are added at the same
 * level. Monitors / load balancers that just check `status === 'ok'` keep
 * working unchanged.
 */
export function registerHealthRoutes(
  app: FastifyInstance,
  deps: HealthDeps,
): void {
  const pre = deps.optionalAuthMiddleware
    ? { preHandler: deps.optionalAuthMiddleware }
    : {};
  app.get('/health', pre, async (req): Promise<HealthResponse> => {
    const base: HealthResponse = {
      status: 'ok',
      uptime_sec: Math.round(process.uptime()),
      timestamp: Date.now(),
      // The API process doesn't own a storage_dir; expose the env value so
      // the user can confirm both api + worker are pointed at the same
      // SQLite file. (Workers and the API both resolve via env.storageDir.)
      storage_dir: process.env['STORAGE_DIR'] ?? '',
      version: process.env['APP_VERSION'] || '0.1.0',
      environment: process.env['NODE_ENV'] || 'development',
    };
    const userId = (req as AuthenticatedRequest).userId;
    if (!userId) return base;
    return {
      ...base,
      worker: {
        status: 'ok',
        last_publish_at: deps.posts.lastPublishedAt(),
        by_status: deps.posts.countByStatus(),
      },
      accounts: deps.accounts.listSlim({ userId }).map((a) => ({
        id: a.id,
        platform: a.platform,
        display_name: a.display_name,
        status: a.status,
      })),
    };
  });
}
