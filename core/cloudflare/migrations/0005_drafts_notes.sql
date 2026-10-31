-- Draft posts (status='draft') need no scheduling until promoted, and
-- notes carries per-post internal annotations.
ALTER TABLE scheduled_posts ADD COLUMN notes TEXT;
