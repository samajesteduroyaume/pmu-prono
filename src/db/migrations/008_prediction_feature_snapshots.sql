ALTER TABLE participants ADD COLUMN prediction_features TEXT;
ALTER TABLE prediction_snapshots ADD COLUMN feature_vector_json TEXT;
