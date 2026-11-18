-- Publishing pipeline hardening:
--   error_class     — classified failure category (token_expired, invalid_video,
--                     missing_permission, rate_limited, transient) for the
--                     publishing control center + smart retry.
--   platform_state  — JSON resumable-upload state (YouTube session URL, FB
--                     session id, IG container id) so a retry resumes the same
--                     remote post instead of duplicating it.
--   platform_params — JSON per-platform publish params (title, hashtags,
--                     visibility overrides) from the composer.
ALTER TABLE scheduled_posts ADD COLUMN error_class TEXT;
ALTER TABLE scheduled_posts ADD COLUMN platform_state TEXT;
ALTER TABLE scheduled_posts ADD COLUMN platform_params TEXT;
