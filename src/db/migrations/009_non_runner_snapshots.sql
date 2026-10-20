ALTER TABLE prediction_snapshots ADD COLUMN is_non_runner INTEGER NOT NULL DEFAULT 0;

UPDATE prediction_snapshots
SET is_non_runner = 1
WHERE participant_id IN (
    SELECT id FROM participants
    WHERE UPPER(TRIM(COALESCE(statut, ''))) IN
        ('NON_PARTANT', 'NON-PARTANT', 'NON PARTANT', 'FORFAIT', 'NP', 'ABANDONNE', 'DISQUALIFIE', 'RETIRE')
);
