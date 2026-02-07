import { fetchDay } from '../core/fetcher.mjs';
import { processDayRaces } from '../core/processor.mjs';
import { initDB, insertCourses, closeDB } from '../core/db.mjs';
import { subDays, format } from 'date-fns';
import logger from '../utils/logger.mjs';

async function sync(daysCount = 1) {
    logger.header(`SYNC ELITE - ${daysCount} JOUR(S)`);
    await initDB();

    const endDate = new Date();

    for (let i = 0; i < daysCount; i++) {
        const currentDate = subDays(endDate, i);
        const dateStr = format(currentDate, 'yyyy-MM-dd');

        logger.info(`[${i + 1}/${daysCount}] Traitement du ${dateStr}...`);

        try {
            const data = await fetchDay(currentDate);
            if (data && data.programme) {
                const processed = processDayRaces(data, dateStr);
                const result = await insertCourses(processed);
                if (result.courseCount > 0) {
                    logger.success(`${dateStr}: ${result.courseCount} courses synchronisées.`);
                } else {
                    logger.info(`${dateStr}: Déjà à jour.`);
                }
            } else {
                logger.warn(`${dateStr}: Aucune donnée.`);
            }
        } catch (error) {
            logger.error(`${dateStr}: ${error.message}`);
        }
    }

    await closeDB();
    logger.header('SYNC TERMINÉ');
}

// Récupération de l'argument (nombre de jours)
const args = process.argv.slice(2);
const days = parseInt(args[0]) || 1;

sync(days).catch(err => {
    console.error('Fatal Sync Error:', err);
    process.exit(1);
});
