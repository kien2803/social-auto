# YouTube API Integration Guide

## Overview

Social-auto uses the YouTube Data API v3 for uploading videos, managing OAuth tokens, and tracking quota usage. This guide covers the implementation details, configuration, and troubleshooting.

## Prerequisites

1. **Google Cloud Project**
   - Create project at console.cloud.google.com
   - Enable YouTube Data API v3
   - Create OAuth 2.0 Client ID (Web application type)

2. **OAuth Consent Screen**
   - User type: External
   - Scopes: `https://www.googleapis.com/auth/youtube.upload`
   - Add your email to test users

3. **Environment Variables**
   ```bash
   GOOGLE_CLIENT_ID=your_client_id
   GOOGLE_CLIENT_SECRET=your_client_secret
   GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback
   ```

## Architecture

### Components

1. **OAuth Flow** (`core/api/src/routes/auth.ts`)
   - `/auth/youtube/start` - Redirects to Google OAuth
   - `/auth/callback` - Exchanges code for tokens
   - Token encryption with AES-256-GCM

2. **YouTube Publisher** (`core/worker/src/publishers/youtube.ts`)
   - Real YouTube upload via googleapis
   - Resumable upload for files > 10MB
   - Progress tracking with callbacks

3. **Quota Management** (`core/worker/src/services/quotaManager.ts`)
   - Tracks daily YouTube API quota (10,000 units/day)
   - Each upload costs 1,600 units
   - Blocks uploads when quota insufficient

### Data Flow

```
User → OAuth Flow → Encrypted Tokens → DB
Worker → Decrypt Tokens → Refresh if needed → YouTube API
Worker → Upload Video → Track Progress → Update Status
```

## Implementation Details

### 1. OAuth Token Management

**Token Storage:**
```typescript
// accounts table schema
{
  oauth_refresh_token: string (encrypted),
  oauth_access_token: string (encrypted, optional cache),
  token_expires_at: timestamp,
  status: 'active' | 'expired' | 'revoked'
}
```

**Token Refresh Logic:**
```typescript
// core/worker/src/index.ts
async function getValidAccessToken(accountId: string, account: Account, deps: PollDeps): Promise<string> {
  const now = Date.now();
  const skew = TOKEN_REFRESH_SKEW_MS; // 60s before expiry
  
  if (account.token_expires_at && account.token_expires_at > now + skew) {
    return account.oauth_access_token; // Use cached token
  }
  
  // Refresh token
  const newTokens = await google.refreshAccessToken(account.oauth_refresh_token);
  // Update database with new tokens
  return newTokens.access_token;
}
```

### 2. YouTube Upload Implementation

**Resumable Upload (files > 10MB):**
```typescript
// core/worker/src/publishers/youtube.ts
async function resumableUpload(youtube: any, input: PublisherInput, fileSize: number): Promise<PublisherUploadResult> {
  const CHUNK_SIZE = 8 * 1024 * 1024; // 8MB chunks
  
  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: input.meta.title,
        description: input.meta.description,
        tags: input.meta.tags,
      },
      status: {
        privacyStatus: input.meta.visibility,
      },
    },
    media: {
      body: createReadStream(input.video.file_path),
      mimeType: 'video/*',
    },
  }, {
    supportsMediaUpload: true,
    mediaUploadOptions: {
      chunkSize: CHUNK_SIZE,
    },
  });
  
  return { external_id: res.data.id, url: `https://youtube.com/watch?v=${res.data.id}` };
}
```

**Direct Upload (files ≤ 10MB):**
```typescript
async function directUpload(youtube: any, input: PublisherInput): Promise<PublisherUploadResult> {
  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: { /* metadata */ },
    media: {
      body: createReadStream(input.video.file_path),
    },
  });
  
  return { external_id: res.data.id, url: `https://youtube.com/watch?v=${res.data.id}` };
}
```

### 3. Progress Tracking

**Progress Callback:**
```typescript
// Worker updates API progress cache
const progressIdentifier = video.file_path;
onProgress?.(progressIdentifier, progress);

// API provides SSE endpoint for real-time updates
app.get('/videos/:id/progress/stream', async (req, reply) => {
  const { id } = req.params;
  
  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  
  const interval = setInterval(() => {
    const progress = getProgress(id);
    if (progress) {
      reply.raw.write(`data: ${JSON.stringify(progress)}\n\n`);
    }
  }, 1000);
  
  req.raw.on('close', () => clearInterval(interval));
});
```

### 4. Quota Management

**Quota Tracking:**
```typescript
// core/worker/src/services/quotaManager.ts
const YOUTUBE_QUOTA_LIMIT = 10000; // units per day
const UPLOAD_COST = 1600; // units per video upload

export class QuotaManager {
  async checkQuota(platform: string): Promise<boolean> {
    if (platform !== 'youtube') return true;
    
    const quota = this.quotasRepo.get('youtube', Date.now());
    return quota.remaining >= UPLOAD_COST;
  }
  
  async recordUpload(platform: string): Promise<void> {
    if (platform !== 'youtube') return;
    
    this.quotasRepo.incrementUsage('youtube', UPLOAD_COST, Date.now());
  }
}
```

**Quota Status Endpoint:**
```typescript
// core/api/src/routes/quota.ts
app.get('/quota/youtube', async () => {
  const q = quotasRepo.get('youtube', Date.now());
  const warning = q.used / q.limit > 0.8;
  
  return {
    platform: 'youtube',
    used: q.used,
    limit: q.limit,
    remaining: q.remaining,
    reset_at: nextMidnightUtc(Date.now()),
    warning,
    upload_cost: 1600,
    uploads_remaining: Math.floor(q.remaining / 1600)
  };
});
```

## Configuration

### Environment Variables

```bash
# Required
TOKEN_ENCRYPTION_KEY=your_32_byte_encryption_key
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback

# Optional
USE_MOCK_GOOGLE=true  # Use mock YouTube client for testing
LOG_LEVEL=info        # Pino log level (debug, info, warn, error)
```

### PM2 Configuration

```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'social-auto-api',
      script: 'core/api/src/server.ts',
      interpreter: 'node',
      interpreter_args: '--loader tsx',
      env: {
        NODE_ENV: 'production',
        API_HOST: '0.0.0.0',
        API_PORT: 3000,
      },
    },
    {
      name: 'social-auto-worker',
      script: 'core/worker/src/index.ts',
      interpreter: 'node',
      interpreter_args: '--loader tsx',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
```

## Troubleshooting

### Common Issues

**1. OAuth Token Expired**
- **Symptom:** 401 errors during upload
- **Solution:** Token refresh logic handles this automatically
- **Check:** Account status in database (`status = 'expired'`)

**2. Quota Exceeded**
- **Symptom:** Uploads blocked with quota error
- **Solution:** Wait until midnight UTC for quota reset
- **Check:** `/quota/youtube` endpoint for remaining quota

**3. Upload Fails Mid-Stream**
- **Symptom:** Status stuck at `uploading`
- **Solution:** Worker unstuck logic resets after 30 minutes
- **Check:** Worker logs for network errors

**4. Large File Memory Issues**
- **Symptom:** Out of memory during upload
- **Solution:** Resumable upload with 8MB chunks
- **Check:** Memory usage with `pm2 monit`

### Debug Mode

Enable debug logging:
```bash
LOG_LEVEL=debug pnpm core:dev:api
```

Use mock YouTube client:
```bash
USE_MOCK_GOOGLE=true pnpm core:dev:worker
```

## Testing

### Unit Tests

```bash
# Test YouTube publisher
pnpm test core/worker/src/publishers/youtube.test.ts

# Test quota management
pnpm test core/worker/src/services/quotaManager.test.ts
```

### Integration Tests

```bash
# Test real OAuth flow (requires Google credentials)
pnpm test core/api/src/routes/auth.test.ts

# Test upload progress tracking
pnpm test core/api/src/routes/uploadProgress.test.ts
```

### Manual Testing

1. **OAuth Flow:**
   - Navigate to `/accounts`
   - Click "Connect YouTube"
   - Complete OAuth flow
   - Verify account appears as "Connected"

2. **Upload Test:**
   - Upload a 30-second video
   - Schedule for "now + 2 minutes"
   - Verify video appears on YouTube Studio

3. **Quota Test:**
   - Check `/quota/youtube` endpoint
   - Upload multiple videos
   - Verify quota decreases correctly

## Security Considerations

1. **Token Encryption**
   - All OAuth tokens encrypted with AES-256-GCM
   - Encryption key stored in environment variable
   - Never log or expose tokens

2. **OAuth Security**
   - Use PKCE for additional security
   - Validate redirect URI
   - Short-lived access tokens (1 hour)

3. **API Security**
   - Rate limiting per account
   - Input validation on all endpoints
   - CORS configuration

## Performance Optimization

1. **Streaming Upload**
   - Avoid loading entire file into memory
   - Use 8MB chunks for resumable upload
   - Progress tracking without blocking

2. **Caching**
   - Cache access tokens until expiry
   - Cache quota status for 1 minute
   - Database connection pooling

3. **Concurrency**
   - Max 3 concurrent uploads
   - Adaptive polling interval
   - Graceful shutdown handling

## Monitoring

### Health Check

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "ok",
  "uptime_sec": 3600,
  "timestamp": 1695123456789,
  "storage_dir": "./storage",
  "worker": {
    "status": "ok",
    "last_publish_at": 1695123450000,
    "by_status": {
      "pending": 5,
      "uploading": 1,
      "published": 42,
      "failed": 2
    }
  },
  "accounts": [
    {
      "id": "acc-123",
      "platform": "youtube",
      "display_name": "My Channel",
      "status": "active"
    }
  ]
}
```

### Logs

```bash
# View API logs
pm2 logs social-auto-api

# View worker logs
pm2 logs social-auto-worker

# View combined logs
pm2 logs
```

## References

- [YouTube Data API v3 Documentation](https://developers.google.com/youtube/v3)
- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [YouTube API Quota Policy](https://developers.google.com/youtube/v3/determine_quota_cost)
- [Google APIs Node.js Client](https://github.com/googleapis/google-api-nodejs-client)