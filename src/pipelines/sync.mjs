import { syncHistory } from '../core/sync_manager.mjs';
import { initDB, closeDB } from '../core/db.mjs';
import { loadMLModel } from '../core/hybrid.mjs';
import logger from '../utils/logger.mjs';
import { isMainModule } from '../utils/isMainModule.mjs';

async function sync(daysCount = 1) {
    logger.header(`SYNC ARCHITECT v27.1 - ${daysCount} JOUR(S)`);
    try {
        await initDB();
        await loadMLModel();
        const results = await syncHistory(null, daysCount);
        if (results.errors.length > 0) {
            logger.warn(`${results.errors.length} erreurs lors de la synchronisation.`);
            process.exitCode = 1;
        } else {
            logger.success(`Synchronisation terminée : ${results.totalCourses} courses traitées.`);
        }
    } catch (error) {
        logger.error(`Erreur fatale lors de la sync : ${error.message}`);
        process.exitCode = 1;
    } finally {
        await closeDB();
    }
}

if (isMainModule(import.meta.url)) {
    // Récupération de l'argument (nombre de jours) uniquement en exécution CLI.
    const args = process.argv.slice(2);
    const days = args.length === 0 ? 1 : Number(args[0]);
    if (!Number.isSafeInteger(days) || days < 1 || days > 365) {
        console.error('Nombre de jours invalide : saisir un entier compris entre 1 et 365.');
        process.exitCode = 1;
    } else {
        sync(days).catch(err => {
            console.error('Fatal Sync Error:', err);
            process.exitCode = 1;
        });
    }
}

export { sync };
