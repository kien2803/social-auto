# Manual Testing Guide for Social Auto

This guide walks you through manually testing the core features of social-auto after the Phase 1 implementation.

## Prerequisites

✅ Dev server running (API: http://127.0.0.1:5182, Web: http://127.0.0.1:5173)
✅ YouTube OAuth credentials configured in `.env.local`
✅ Storage directory created: `./storage/`

---

## Test 1: YouTube OAuth Connection

### Objective
Verify that you can connect a YouTube account via OAuth.

### Steps

1. **Open Web UI**
   - Navigate to: http://127.0.0.1:5173
   - You should see the accounts page

2. **Connect YouTube Account**
   - Click "Add Account" → "YouTube"
   - This redirects to Google OAuth consent screen
   - Sign in with your Google account
   - Grant permissions for YouTube upload
   - Redirect back to the app

3. **Verify Connection**
   - Check that the YouTube account appears in the accounts list
   - Verify status shows "active"
   - Verify display name and avatar are loaded

### Expected Results
- ✅ OAuth flow completes successfully
- ✅ Account appears in the UI with correct display name
- ✅ Status shows "active"
- ✅ Avatar image loads (if available)

### Troubleshooting
- If OAuth fails: Check `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in `.env.local`
- Ensure redirect URI matches: `http://localhost:5181/auth/callback` (note: port 5181, not 5182)
- Check browser console for errors

---

## Test 2: Video Upload with File Validation

### Objective
Test video upload with enhanced file validation (magic number detection, duration validation).

### Steps

1. **Prepare Test Videos**
   - Create or download test videos:
     - Short video (< 15 min): `test-short.mp4`
     - Long video (> 15 min, < 12 hr): `test-long.mp4`
     - Invalid format (spoofed extension): `test.mp4` (actually a text file renamed)

2. **Upload Valid Video**
   - On the web UI, navigate to upload page
   - Select `test-short.mp4`
   - Click "Upload"
   - Wait for upload to complete

3. **Upload Long Video**
   - Select `test-long.mp4`
   - Click "Upload"
   - Check console logs for duration warning

4. **Upload Invalid Format**
   - Select the spoofed file
   - Click "Upload"
   - Verify it's rejected or logged with warning

### Expected Results
- ✅ Valid video uploads successfully
- ✅ Thumbnail is generated
- ✅ Duration is probed and logged
- ✅ Long video logs warning about exceeding 15 min
- ✅ Invalid format is either rejected or logged with magic number detection warning

### Verification
- Check storage directory: `./storage/` for uploaded files
- Check database for video records
- Console logs should show validation results

---

## Test 3: Schedule and Publish a Post

### Objective
Test the complete flow: upload video → schedule post → worker publishes to YouTube.

### Steps

1. **Upload a Test Video**
   - Upload a short test video (preferably < 5 min for faster processing)
   - Note the video ID from the UI or API response

2. **Create Scheduled Post**
   - Navigate to schedule page
   - Select the uploaded video
   - Select YouTube account
   - Set title: "Test Upload - Manual Testing"
   - Set description: "This is a test upload for manual testing of Phase 1 implementation"
   - Set visibility: "private" (for testing)
   - Set scheduled time: 1 minute from now
   - Click "Schedule"

3. **Monitor Worker**
   - Check worker console logs (dev server terminal)
   - Look for:
     ```
     [worker] claimed 1 post(s)
     [worker] processing <post-id>
     [worker] published <post-id> -> <youtube-video-id>
     ```

4. **Verify on YouTube**
   - Go to YouTube Studio: https://studio.youtube.com
   - Check "Videos" tab
   - Look for your test video
   - Verify it's private and has correct metadata

### Expected Results
- ✅ Post is created in database with "pending" status
- ✅ Worker claims the post at scheduled time
- ✅ Worker uploads to YouTube successfully
- ✅ Post status changes to "published"
- ✅ Video appears on YouTube with correct title/description

### Troubleshooting
- If worker doesn't publish: Check worker logs for errors
- Verify YouTube quota hasn't been exhausted
- Check that OAuth token is valid (not expired)
- Ensure video file exists at the expected path

---

## Test 4: Storage Management

### Objective
Test storage quota enforcement and cleanup.

### Steps

1. **Check Storage Status**
   - Call API: `GET http://127.0.0.1:5182/storage`
   - Note the current usage and quota

2. **Upload Multiple Videos**
   - Upload several test videos to fill storage
   - Monitor storage usage

3. **Trigger Cleanup**
   - Call API: `POST http://127.0.0.1:5182/storage/cleanup`
   - Verify orphaned files are removed
   - Check storage usage decreased

4. **Test Quota Enforcement**
   - If you have storage quota configured, try uploading beyond quota
   - Verify you get a quota error or warning

### Expected Results
- ✅ Storage status endpoint returns correct usage
- ✅ Cleanup removes orphaned files
- ✅ Quota enforcement blocks uploads when full
- ✅ Logs show storage operations

### API Endpoints
- `GET /storage` - Get storage status
- `POST /storage/cleanup` - Trigger cleanup
- `DELETE /storage/:id` - Delete specific video

---

## Test 5: Quota Management

### Objective
Test YouTube API quota tracking and enforcement.

### Steps

1. **Check Quota Status**
   - Call API: `GET http://127.0.0.1:5182/quota/youtube`
   - Note the current usage, limit, and remaining

2. **Upload a Video**
   - Schedule and publish a video (as in Test 3)
   - Wait for worker to complete

3. **Check Quota Again**
   - Call API: `GET http://127.0.0.1:5182/quota/youtube`
   - Verify usage increased by 1600 units (YouTube upload cost)
   - Verify remaining decreased

4. **Test Quota Exhaustion**
   - This is hard to test manually without exhausting real quota
   - Instead, verify the worker checks quota before publishing
   - Check worker logs for quota check messages

### Expected Results
- ✅ Quota endpoint returns correct status
- ✅ Usage increases after successful upload
- ✅ Warning flag appears when usage > 80%
- ✅ Worker checks quota before publishing
- ✅ Worker logs quota-related messages

### API Endpoints
- `GET /quota` - Get all platform quotas
- `GET /quota/youtube` - Get YouTube-specific quota with details

---

## Test 6: Error Handling

### Objective
Test error scenarios and recovery.

### Steps

1. **Upload Corrupted Video**
   - Try uploading a corrupted video file
   - Verify it's rejected with clear error message

2. **Revoke OAuth Access**
   - Go to Google Account settings
   - Revoke access for social-auto
   - Try to schedule a post
   - Verify worker marks account as "expired"
   - Verify UI shows account as expired

3. **Network Interruption**
   - Start an upload
   - Disconnect network during upload
   - Verify retry logic works (if implemented)
   - Verify error is logged

### Expected Results
- ✅ Clear error messages for invalid inputs
- ✅ Account marked expired when OAuth revoked
- ✅ Retry logic handles transient failures
- ✅ Errors are logged with context

---

## Test 7: Progress Tracking (Phase 1 Basic)

### Objective
Test basic progress tracking (console logging in Phase 1).

### Steps

1. **Schedule a Large Video Upload**
   - Upload a larger video (> 50MB if possible)
   - Schedule it for immediate publication

2. **Monitor Worker Console**
   - Watch the worker terminal
   - Look for progress messages:
     ```
     [worker] progress <video-id>: 10.0%
     [worker] progress <video-id>: 25.0%
     [worker] progress <video-id>: 50.0%
     ```

### Expected Results
- ✅ Progress is logged to console
- ✅ Progress percentage increases over time
- ✅ Progress reaches 100% when complete

### Note
Phase 1 only includes console logging. Real-time progress via API will be implemented in Phase 2.

---

## Cleanup After Testing

1. **Delete Test Videos**
   - Go to YouTube Studio
   - Delete test videos
   - Or set them to unlisted/private

2. **Clean Storage**
   - Call API: `POST http://127.0.0.1:5182/storage/cleanup`
   - Or manually delete files from `./storage/`

3. **Reset Database (Optional)**
   - Stop dev server
   - Delete `./storage/app.db`
   - Restart server (creates fresh database)

---

## Common Issues and Solutions

### Issue: OAuth Fails
**Solution:** Check redirect URI matches exactly (including port)

### Issue: Worker Doesn't Publish
**Solution:** Check worker logs, verify OAuth token is valid, check quota

### Issue: Video Upload Fails
**Solution:** Check file format, ensure it's a valid video file, check disk space

### Issue: Storage Quota Errors
**Solution:** Run cleanup, delete old videos, or increase `STORAGE_QUOTA_GB` in `.env.local`

### Issue: Quota Exhausted
**Solution:** Wait for daily reset (midnight UTC) or increase quota (if using test account)

---

## Testing Checklist

Use this checklist to track your testing progress:

- [ ] YouTube OAuth connection works
- [ ] Valid video uploads successfully
- [ ] Duration validation logs warnings
- [ ] Magic number detection works
- [ ] Scheduled post is created
- [ ] Worker publishes to YouTube
- [ ] Video appears on YouTube with correct metadata
- [ ] Storage status endpoint works
- [ ] Storage cleanup removes orphaned files
- [ ] Quota status endpoint works
- [ ] Quota usage increases after upload
- [ ] Worker checks quota before publishing
- [ ] Progress is logged to console
- [ ] Error handling works for invalid inputs
- [ ] Account marked expired when OAuth revoked

---

## Next Steps

After completing manual testing:
1. Document any bugs found
2. Update `plans/core/phase-1-production-mvp/fix-bugs.md` with issues
3. Decide if fixes are needed before proceeding to Phase 2
4. Consider writing automated tests for critical paths
