-- Pre-Publish Intelligence: client-extracted frame dimensions so the
-- preflight inspector can check aspect ratio / resolution per platform.
-- Nullable — rows uploaded before this migration report "dimensions
-- unknown" as a warning, not a failure.
ALTER TABLE videos ADD COLUMN width INTEGER;
ALTER TABLE videos ADD COLUMN height INTEGER;
