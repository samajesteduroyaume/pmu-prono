-- 004_add_corde_poids.sql
-- Ajout des colonnes corde et poids dans la table participants

ALTER TABLE participants ADD COLUMN corde INTEGER DEFAULT 0;
ALTER TABLE participants ADD COLUMN poids REAL DEFAULT 0;
