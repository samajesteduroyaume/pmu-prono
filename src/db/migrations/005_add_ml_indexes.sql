-- Migration 005: Index d'optimisation pour la préparation du dataset ML et les filtres de résultats
CREATE INDEX IF NOT EXISTS idx_courses_ordre_arrivee ON courses(ordre_arrivee);
CREATE INDEX IF NOT EXISTS idx_courses_discipline_date ON courses(discipline, date);
