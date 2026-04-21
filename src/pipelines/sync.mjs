import { syncHistory } from '../core/sync_manager.mjs';
import { initDB, closeDB } from '../core/db.mjs';
import { loadMLModel } from '../core/hybrid.mjs';
import logger from '../utils/logger.mjs';

async function sync(daysCount = 1) {
    logger.header(`SYNC ARCHITECT v27.1 - ${daysCount} JOUR(S)`);
    await initDB();
    await loadMLModel();

    try {
        const results = await syncHistory(null, daysCount);
        if (results.errors.length > 0) {
            logger.warn(`${results.errors.length} erreurs lors de la synchronisation.`);
        }
        logger.success(`Synchronisation terminée : ${results.totalCourses} courses traitées.`);
    } catch (error) {
        logger.error(`Erreur fatale lors de la sync : ${error.message}`);
    } finally {
        await closeDB();
    }
}

// Récupération de l'argument (nombre de jours)
const args = process.argv.slice(2);
const days = parseInt(args[0]) || 1;

sync(days).catch(err => {
    console.error('Fatal Sync Error:', err);
    process.exit(1);
});
