import logger from '../utils/logger.mjs';
import { fetchDay } from './fetcher.mjs';
import { processDayRaces } from './processor.mjs';
import { insertCourses } from './db.mjs';

/**
 * SYNC MANAGER v27.1
 * Centralise la logique de synchronisation multi-jours et live.
 */
export async function syncHistory(startDate, days = 1) {
    const results = {
        totalDays: days,
        successfulDays: 0,
        totalCourses: 0,
        errors: []
    };

    const targetDate = startDate ? new Date(startDate) : new Date();

    for (let i = 0; i < days; i++) {
        const current = new Date(targetDate);
        current.setDate(current.getDate() - i);
        const dateStr = current.toISOString().split('T')[0];

        try {
            logger.info(`[SYNC MANAGER] Sync [${i + 1}/${days}] - ${dateStr}`);
            const data = await fetchDay(current);
            
            if (data && data.programme) {
                const processed = await processDayRaces(data, current);
                const count = await insertCourses(processed);
                results.totalCourses += count;
                results.successfulDays++;
                logger.info(`[SYNC MANAGER] OK: ${dateStr} - ${count} courses synchronisées.`);
            } else {
                logger.warn(`[SYNC MANAGER] No data for ${dateStr}`);
            }
        } catch (error) {
            logger.error(`[SYNC MANAGER] Error for ${dateStr}: ${error.message}`);
            results.errors.push({ date: dateStr, error: error.message });
        }
    }

    return results;
}

/**
 * Live Sync: Récupère uniquement les mises à jour pour aujourd'hui
 */
export async function syncLive() {
    return await syncHistory(new Date(), 1);
}
