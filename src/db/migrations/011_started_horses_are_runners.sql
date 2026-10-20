-- Abandons and disqualifications happen after the start; they are results,
-- not non-starters, and must remain in training/evaluation cohorts.
UPDATE prediction_snapshots
SET is_non_runner = 0
WHERE participant_id IN (
    SELECT id FROM participants
    WHERE UPPER(TRIM(COALESCE(statut, ''))) IN ('ABANDONNE', 'DISQUALIFIE', 'RETIRE')
);
