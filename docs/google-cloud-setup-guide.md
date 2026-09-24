# Google Cloud Console Setup Guide for YouTube API

This guide walks you through setting up Google Cloud Console to use YouTube API with social-auto.

---

## Prerequisites

- Google Account
- Access to Google Cloud Console
- Project already created (you have one with client ID: `260502027484-dp47rippejgmsj4iiths47vdp21s14mg.apps.googleusercontent.com`)

---

## Step 1: Open Google Cloud Console

1. Go to: https://console.cloud.google.com/apis/credentials
2. Select your project (or create a new one)
3. Navigate to "Credentials" tab

---

## Step 2: Update OAuth 2.0 Client ID

### Current Client ID
```
260502027484-dp47rippejgmsj4iiths47vdp21s14mg.apps.googleusercontent.com
```

### Update Redirect URIs

1. Click on your OAuth 2.0 Client ID
2. Scroll to "Authorized redirect URIs"
3. Add the following URI:
   ```
   http://localhost:5173/auth/callback
   ```
4. Click "Save"

**Important:** The redirect URI must match exactly:
- Protocol: `http://` (not `https://` for local dev)
- Host: `localhost`
- Port: `5173` (frontend port, not API port 5182)
- Path: `/auth/callback`

---

## Step 3: Enable YouTube Data API v3

1. Go to: https://console.cloud.google.com/apis/library
2. Search for "YouTube Data API v3"
3. Click on it
4. Click "Enable"

**Required Scopes:**
The app needs these scopes (already configured in your OAuth consent screen):
- `https://www.googleapis.com/auth/youtube.upload` - Upload videos
- `https://www.googleapis.com/auth/youtube` - Read/write YouTube data

---

## Step 4: Configure OAuth Consent Screen

1. Go to: https://console.cloud.google.com/apis/credentials/consent
2. Select "External" user type (for testing)
3. Fill in required fields:
   - App name: "Social Auto" (or your preferred name)
   - User support email: your email
   - Developer contact email: your email
4. Click "Save and Continue"

### Add Scopes

1. Click "Add or Remove Scopes"
2. Add these scopes:
   - `https://www.googleapis.com/auth/youtube.upload`
   - `https://www.googleapis.com/auth/youtube`
3. Click "Update"
4. Click "Save and Continue"

### Add Test Users

1. Click "Add Users"
2. Add your Google email address
3. Click "Add"
4. Click "Save and Continue"

**Note:** In "Testing" mode, only test users can use the app. For production, you'll need to submit for verification.

---

## Step 5: Verify Credentials

After completing the steps above, verify your credentials:

### Client ID
```
YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com
```

### Client Secret
```
YOUR_GOOGLE_CLIENT_SECRET
```

### Redirect URI
```
http://localhost:5173/auth/callback
```

These should match your `.env.local` file:
```bash
GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=YOUR_GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI=http://localhost:5173/auth/callback
```

---

## Step 6: Restart Dev Server

After updating Google Cloud Console, restart the dev server:

```bash
# Stop current server (Ctrl+C)
# Restart
pnpm dev
```

---

## Step 7: Test OAuth Flow

1. Open browser: http://localhost:5173
2. Click "Add Account" → "YouTube"
3. You should be redirected to Google OAuth consent screen
4. Sign in with your Google account (must be a test user)
5. Grant permissions
6. Redirect back to the app
7. Verify account appears in the UI with status "active"

---

## Troubleshooting

### Error: redirect_uri_mismatch

**Cause:** Redirect URI in Google Cloud Console doesn't match the app's redirect URI.

**Solution:**
1. Check `.env.local`: `GOOGLE_REDIRECT_URI=http://localhost:5173/auth/callback`
2. Go to Google Cloud Console → Credentials
3. Click on OAuth 2.0 Client ID
4. Add `http://localhost:5173/auth/callback` to "Authorized redirect URIs"
5. Save

### Error: Access blocked: This app's request is invalid

**Cause:** Same as above - redirect URI mismatch.

**Solution:** Same as above.

### Error: 403: Forbidden

**Cause:** YouTube Data API v3 not enabled.

**Solution:**
1. Go to: https://console.cloud.google.com/apis/library
2. Search for "YouTube Data API v3"
3. Click "Enable"

### Error: insufficient_permissions

**Cause:** Required scopes not granted in OAuth consent screen.

**Solution:**
1. Go to OAuth consent screen
2. Add scopes:
   - `https://www.googleapis.com/auth/youtube.upload`
   - `https://www.googleapis.com/auth/youtube`
3. Save

### Error: unauthorized_client

**Cause:** Client ID or secret is incorrect.

**Solution:**
1. Verify client ID and secret in Google Cloud Console
2. Update `.env.local` with correct values
3. Restart server

---

## Production Deployment

When deploying to production:

### Update Redirect URIs

Replace `http://localhost:5173` with your production domain:
```
https://yourdomain.com/auth/callback
```

### Update .env.local

```bash
WEB_ORIGIN=https://yourdomain.com
GOOGLE_REDIRECT_URI=https://yourdomain.com/auth/callback
```

### Submit for Verification

For production use:
1. Go to OAuth consent screen
2. Click "Submit for Verification"
3. Provide required documentation (privacy policy, terms of service, etc.)
4. Wait for Google approval (can take days to weeks)

### Use Verified Domain

- Add your domain to Google Search Console
- Verify domain ownership
- This speeds up verification process

---

## Security Best Practices

1. **Never commit `.env.local` to git**
2. **Use different credentials for dev and production**
3. **Restrict API key usage** (if using API key)
4. **Monitor API usage** in Google Cloud Console
5. **Set up alerts** for quota limits
6. **Rotate credentials** periodically
7. **Revoke unused OAuth tokens**

---

## YouTube API Quota

### Default Quota
- **Daily quota:** 10,000 units
- **Cost per upload:** 1,600 units
- **Maximum uploads per day:** ~6 videos

### Increase Quota
1. Go to: https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas
2. Request quota increase
3. Provide justification (e.g., "production application")
4. Wait for approval

### Monitor Quota
Use the app's quota endpoint:
```bash
curl http://localhost:5182/quota/youtube
```

---

## Testing Checklist

- [ ] YouTube Data API v3 enabled
- [ ] OAuth consent screen configured
- [ ] Required scopes added
- [ ] Test users added
- [ ] Redirect URI matches: `http://localhost:5173/auth/callback`
- [ ] Client ID and secret correct in `.env.local`
- [ ] Mock mode disabled: `USE_MOCK_GOOGLE=false`
- [ ] Dev server restarted
- [ ] OAuth flow redirects to Google
- [ ] Account appears in UI after OAuth
- [ ] Account status shows "active"

---

## Next Steps

After completing setup:

1. **Test OAuth Flow**
   - Connect YouTube account
   - Verify account appears in UI

2. **Test Video Upload**
   - Upload a test video
   - Verify it appears in YouTube Studio

3. **Test Scheduled Publishing**
   - Schedule a post
   - Monitor worker logs
   - Verify video published to YouTube

4. **Monitor Quota**
   - Check quota usage
   - Verify quota tracking works

---

## Additional Resources

- [YouTube Data API Documentation](https://developers.google.com/youtube/v3)
- [Google Cloud Console](https://console.cloud.google.com)
- [OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [YouTube API Quota Guide](https://developers.google.com/youtube/v3/determine_quota_cost)

---

## Support

If you encounter issues:

1. Check browser console (F12) for errors
2. Check dev server logs
3. Verify Google Cloud Console settings
4. Consult [OAuth Troubleshooting Guide](./oauth-troubleshooting.md)
5. Check [Manual Testing Guide](./manual-testing-guide.md)
