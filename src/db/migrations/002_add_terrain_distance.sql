-- 002_add_terrain_distance.sql
-- v43: Ajout des colonnes terrain et distance_course pour les signaux PMU

-- Ajout du terrain (état de la piste au moment de la course) dans la table courses
ALTER TABLE courses ADD COLUMN terrain TEXT;

-- Ajout de la distance réelle de la course dans les participants
-- (redondant avec courses.distance mais permet les jointures rapides)
ALTER TABLE participants ADD COLUMN distance_course INTEGER;

-- Ajout de l'historique des distances sous forme JSON ["2200", "2400", "2600"]
-- pour analyser la spécialisation à une distance
ALTER TABLE participants ADD COLUMN distances_history TEXT;

-- Ajout de la préférence de terrain déclarée par l'entraîneur (ex: "BON", "SOUPLE", "LOURD")
ALTER TABLE participants ADD COLUMN terrain_prefere TEXT;

-- Index sur terrain pour les analyses par conditions
CREATE INDEX IF NOT EXISTS idx_courses_terrain ON courses(terrain);
