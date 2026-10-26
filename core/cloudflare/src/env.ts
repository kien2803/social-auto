/** Cloudflare bindings + vars for the Worker. */
export interface Env {
  // Bindings
  DB: D1Database;
  STORAGE: R2Bucket;
  PUBLISH_QUEUE: Queue<PublishJob>;

  // Vars (wrangler.toml [vars])
  WEB_ORIGIN: string;
  SECURE_COOKIES: string;
  STORAGE_QUOTA_GB: string;
  META_API_VERSION: string;

  // Secrets (wrangler secret put)
  TOKEN_ENCRYPTION_KEY: string;
  JWT_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  TIKTOK_CLIENT_KEY?: string;
  TIKTOK_CLIENT_SECRET?: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
}

/** Message sent through the publish queue (replaces the poll-claim loop). */
export interface PublishJob {
  postId: string;
  attempt: number;
}
