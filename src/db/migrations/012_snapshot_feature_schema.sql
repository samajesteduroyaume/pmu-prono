-- Existing feature vectors predate the neutral handling of unknown terrain.
-- Mark them as schema 1; new captures explicitly use schema 2.
ALTER TABLE prediction_snapshots
ADD COLUMN feature_schema_version INTEGER NOT NULL DEFAULT 1;
