ALTER TABLE participants ADD COLUMN prediction_heuristic_score REAL;
ALTER TABLE prediction_snapshots ADD COLUMN heuristic_score REAL;

-- Historical fallback snapshots contain the heuristic output as prediction_score.
UPDATE prediction_snapshots
SET heuristic_score = prediction_score
WHERE model_version = 'heuristic-fallback' AND heuristic_score IS NULL;
