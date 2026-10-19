import { initDB, closeDB, getDB } from '../db/db.mjs';
import logger from '../utils/logger.mjs';
import { isMainModule } from '../utils/isMainModule.mjs';

async function backfill() {
    try {
        await initDB();
        const db = getDB();
        logger.header('DÉBUT DU BACKFILL TECHNIQUE (v43.1)');

        // 1. Mise à jour de distance_course (provient de la table courses)
        logger.info('Mise à jour des distances de course...');
        await new Promise((resolve, reject) => {
            db.run(`
                UPDATE participants
                SET distance_course = (
                    SELECT CAST(c.distance AS INTEGER)
                    FROM courses c
                    WHERE c.id = participants.course_id
                )
                WHERE distance_course IS NULL OR distance_course = 0
            `, (err) => err ? reject(err) : resolve());
        });
        logger.success('Distances de course mises à jour.');

        // 2. Mise à jour de terrain_prefere (basé sur l'historique des victoires) - VERSION OPTIMISÉE
        logger.info('Calcul des préférences de terrain (SQL intensif)...');
        await new Promise((resolve, reject) => {
            db.run(`
                UPDATE participants
                SET terrain_prefere = (
                    SELECT c.terrain
                    FROM participants p2
                    JOIN courses c ON p2.course_id = c.id
                    WHERE p2.nom = participants.nom
                      AND CAST(p2.classement AS INTEGER) = 1
                      AND COALESCE(c.ordre_arrivee, '') <> ''
                      AND c.terrain IS NOT NULL AND c.terrain <> ''
                    GROUP BY c.terrain
                    ORDER BY COUNT(*) DESC
                    LIMIT 1
                )
                WHERE terrain_prefere IS NULL
            `, (err) => err ? reject(err) : resolve());
        });
        logger.success('Préférences de terrain mises à jour.');

    } catch (error) {
        logger.error(`Erreur backfill : ${error.message}`);
        process.exitCode = 1;
    } finally {
        await closeDB();
    }
}

if (isMainModule(import.meta.url)) {
    backfill().catch(error => {
        logger.error(`Erreur fatale backfill : ${error.message}`);
        process.exitCode = 1;
    });
}

export { backfill };
