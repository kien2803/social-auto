# OAuth Troubleshooting Guide

## Common OAuth Issues and Solutions

This guide covers common OAuth connection issues for YouTube, TikTok, Instagram, and Facebook, and their solutions.

---

## Issue 1: Port Mismatch / Connection Refused

### Symptoms
- Web UI shows "ECONNREFUSED" errors
- OAuth redirect fails
- API calls from frontend fail

### Root Cause
Web frontend proxy target doesn't match API server port.

### Solution
Ensure all ports are consistent across configuration files:

**.env.local:**
```bash
API_PORT=5182
WEB_ORIGIN=http://localhost:5173
GOOGLE_REDIRECT_URI=http://localhost:5173/auth/callback
TIKTOK_REDIRECT_URI=http://localhost:5173/auth/tiktok/callback
META_REDIRECT_URI=http://localhost:5173/auth/meta/callback
```

**core/web/vite.config.ts:**
```typescript
const apiTarget = process.env['VITE_API_TARGET'] || 'http://localhost:5182';
```

**Verify:**
- API server runs on port 5182
- Web frontend runs on port 5173
- All redirect URIs use port 5173 (frontend port, not API port)

---

## Issue 2: Redirect URI Mismatch

### Symptoms
- OAuth error: "redirect_uri_mismatch"
- Google Cloud Console shows error
- Token exchange fails

### Root Cause
Redirect URI in Google Cloud Console doesn't match the actual redirect URI used by the app.

### Solution

**Step 1: Check current redirect URI in .env.local**
```bash
GOOGLE_REDIRECT_URI=http://localhost:5173/auth/callback
```

**Step 2: Update Google Cloud Console**
1. Go to: https://console.cloud.google.com/apis/credentials
2. Select your OAuth 2.0 client ID
3. Under "Authorized redirect URIs", add:
   - `http://localhost:5173/auth/callback`
4. Save changes

**Step 3: For production deployment**
- Replace `localhost:5173` with your production domain
- Example: `https://yourdomain.com/auth/callback`

**Step 4: Same for other platforms**
- TikTok: Add `http://localhost:5173/auth/tiktok/callback` to TikTok app settings
- Meta: Add `http://localhost:5173/auth/meta/callback` to Facebook app settings

---

## Issue 3: Missing or Invalid OAuth Credentials

### Symptoms
- Error: "Missing required env var: GOOGLE_CLIENT_ID"
- Error: "invalid_client"
- OAuth flow fails to start

### Root Cause
OAuth credentials not configured or invalid in `.env.local`.

### Solution

**For YouTube/Google:**
```bash
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

Get credentials from: https://console.cloud.google.com/apis/credentials

**For TikTok:**
```bash
TIKTOK_CLIENT_KEY=your-client-key
TIKTOK_CLIENT_SECRET=your-client-secret
```

Get credentials from: https://developers.tiktok.com/apps

**For Meta (Facebook/Instagram):**
```bash
META_APP_ID=your-app-id
META_APP_SECRET=your-app-secret
```

Get credentials from: https://developers.facebook.com/apps

---

## Issue 4: Wrong Scopes/Permissions

### Symptoms
- OAuth succeeds but upload fails
- Error: "insufficient_permissions"
- Error: "Access denied"

### Root Cause
OAuth app doesn't have required scopes/permissions enabled.

### Solution

**YouTube Required Scopes:**
- `https://www.googleapis.com/auth/youtube.upload`
- `https://www.googleapis.com/auth/youtube`

Enable in Google Cloud Console:
1. Go to: https://console.cloud.google.com/apis/credentials
2. Click "OAuth consent screen"
3. Add required scopes
4. Submit for verification (or use testing mode)

**TikTok Required Scopes:**
- `user.info.basic`
- `video.upload`
- `video.publish`

Enable in TikTok Developer Portal:
1. Go to: https://developers.tiktok.com/apps
2. Select your app
3. Enable "Login Kit" product
4. Request and approve required scopes

**Meta Required Scopes:**
- `pages_show_list`
- `pages_manage_posts`
- `instagram_basic`
- `instagram_content_publish`

Enable in Facebook Developer Portal:
1. Go to: https://developers.facebook.com/apps
2. Select your app
3. Enable "Facebook Login" product
4. Add required scopes
5. Set app to "Live" mode (not Development)

---

## Issue 5: App in Development Mode

### Symptoms (Meta/Facebook/Instagram)
- OAuth fails with "App not in live mode"
- Can't connect Instagram Business account
- Pages not accessible

### Root Cause
Meta app is in Development mode, which has restrictions.

### Solution

**Option 1: Add Test Users (Quick Fix)**
1. Go to: https://developers.facebook.com/apps
2. Select your app
3. Go to "Roles" → "Test Users"
4. Add yourself as a test user
5. Use test user account for OAuth

**Option 2: Move to Live Mode (Production)**
1. Go to: https://developers.facebook.com/apps
2. Select your app
3. Click "Switch to Live"
4. Complete required verification steps
5. Add privacy policy URL, terms of service, etc.

**Note:** Live mode requires Facebook to review your app, which can take days.

---

## Issue 6: Token Encryption Key Issues

### Symptoms
- Error: "Missing required env var: TOKEN_ENCRYPTION_KEY"
- Error: "Invalid token"
- Can't save OAuth tokens

### Root Cause
Token encryption key missing or changed.

### Solution

**Generate a new key:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Add to .env.local:**
```bash
TOKEN_ENCRYPTION_KEY=<your-64-char-hex-key>
```

**Important:**
- Keep this key secret
- Don't change it after storing tokens (it will invalidate all stored tokens)
- Use the same key across API and Worker

---

## Issue 7: CORS Errors

### Symptoms
- Browser console shows CORS errors
- API calls blocked by CORS policy
- Preflight requests fail

### Root Cause
CORS configuration doesn't allow frontend origin.

### Solution

**Check .env.local:**
```bash
WEB_ORIGIN=http://localhost:5173
```

**Check API server CORS config:**
```typescript
await app.register(cors, {
  origin: env.webOrigin,
  credentials: true,
});
```

**For production:**
- Set `WEB_ORIGIN` to your production domain
- Example: `https://yourdomain.com`

---

## Issue 8: Mock Mode Enabled

### Symptoms
- OAuth doesn't redirect to real OAuth provider
- Accounts show as "mock-..." prefix
- Uploads don't actually publish

### Root Cause
Mock mode flags are enabled in `.env.local`.

### Solution

**Check .env.local:**
```bash
USE_MOCK_GOOGLE=false
USE_MOCK_PUBLISHERS=false
USE_MOCK_TIKTOK=false
USE_MOCK_META=false
```

**Set all to `false`** for real OAuth.

**For local dev without credentials:**
Set to `true` to test UI without real OAuth.

---

## Issue 9: Network/Firewall Blocking

### Symptoms
- OAuth timeout
- Connection refused
- SSL/TLS errors

### Root Cause
Firewall or network blocking OAuth provider.

### Solution

**Check firewall:**
- Allow outbound connections to:
  - `accounts.google.com`
  - `oauth.tiktok.com`
  - `graph.facebook.com`

**Check corporate network:**
- May need to use proxy
- May need VPN

**Check SSL certificates:**
- Ensure system time is correct
- Update SSL certificates if needed

---

## Issue 10: Session/Cookie Issues

### Symptoms
- OAuth callback fails to save account
- Login state lost after redirect
- "Unauthorized" errors

### Root Cause
Cookie or session configuration issues.

### Solution

**Check API server cookie config:**
```typescript
await app.register(cookie);
```

**Check browser:**
- Allow cookies for localhost
- Disable third-party cookie blocking
- Clear browser cache and cookies

**Check CORS credentials:**
```typescript
await app.register(cors, {
  origin: env.webOrigin,
  credentials: true, // Must be true for cookies
});
```

---

## Platform-Specific Issues

### YouTube/Google

**Error: "ApiNotActivated"**
- Enable YouTube Data API v3 in Google Cloud Console
- Go to: https://console.cloud.google.com/apis/library

**Error: "quotaExceeded"**
- YouTube API quota exhausted
- Wait for daily reset (midnight Pacific Time)
- Request quota increase in Google Cloud Console

### TikTok

**Error: "invalid_scope"**
- Scopes not approved for your app
- Submit for review in TikTok Developer Portal

**Error: "app_not_approved"**
- App not approved for production use
- Use test mode or submit for review

### Meta (Facebook/Instagram)

**Error: "IG Platform API Not Approved"**
- Instagram Business account not approved
- Must submit for review
- Can take weeks for approval

**Error: "Page not accessible"**
- You're not admin of the Facebook Page
- Ensure you have "Admin" role
- Link Instagram Business account to Facebook Page

---

## Quick Debug Checklist

When OAuth fails, check:

1. ✅ All ports match (5182 for API, 5173 for web)
2. ✅ Redirect URIs match in OAuth provider console
3. ✅ OAuth credentials are valid and not expired
4. ✅ Required scopes are enabled
5. ✅ App is in correct mode (Development vs Live)
6. ✅ Token encryption key is set
7. ✅ CORS is configured correctly
8. ✅ Mock mode is disabled (for real OAuth)
9. ✅ Network/firewall allows connections
10. ✅ Browser allows cookies

---

## Testing OAuth Flow

### Test YouTube OAuth
```bash
# 1. Start dev server
pnpm dev

# 2. Open browser
http://localhost:5173

# 3. Try to connect YouTube account
# Should redirect to Google OAuth consent screen

# 4. After auth, check browser network tab
# Look for /auth/callback request
# Should return account data
```

### Test API Directly
```bash
# Test auth start
curl http://localhost:5182/auth/youtube/start

# Test callback (after OAuth)
curl "http://localhost:5182/auth/callback?code=<your-code>"
```

---

## Getting Help

If you're still stuck:

1. **Check logs:**
   - API server logs (dev server terminal)
   - Browser console (F12)
   - Network tab for failed requests

2. **Verify configuration:**
   - `.env.local` values
   - OAuth provider console settings
   - Port numbers

3. **Consult documentation:**
   - `docs/features/youtube-oauth.md`
   - `docs/features/tiktok-oauth.md`
   - `docs/features/meta-oauth.md`

4. **Check common issues:**
   - This troubleshooting guide
   - `plans/core/phase-1-production-mvp/fix-bugs.md`

---

## Security Best Practices

1. **Never commit `.env.local` to git**
2. **Use different credentials for dev and production**
3. **Rotate OAuth credentials periodically**
4. **Monitor OAuth token usage**
5. **Revoke unused OAuth access**
6. **Keep token encryption key secret**
7. **Use HTTPS in production**
8. **Set appropriate cookie security flags in production**
