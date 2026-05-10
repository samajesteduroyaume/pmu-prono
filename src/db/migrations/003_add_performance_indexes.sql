-- Migration 003: Indexation pour accélérer les performances de backtest et de l'UI
-- Ajout d'index sur les colonnes massivement interrogées lors de getHorseHistory et getPepites

CREATE INDEX IF NOT EXISTS idx_participants_nom ON participants(nom);
CREATE INDEX IF NOT EXISTS idx_participants_course_id ON participants(course_id);
CREATE INDEX IF NOT EXISTS idx_courses_date ON courses(date);
