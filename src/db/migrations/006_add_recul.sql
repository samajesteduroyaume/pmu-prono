-- 006_add_recul.sql
-- Ajout de la colonne recul dans la table participants

ALTER TABLE participants ADD COLUMN recul REAL DEFAULT 0;
