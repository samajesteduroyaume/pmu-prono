import logger from '../utils/logger.mjs';
import { fetchDay } from './fetcher.mjs';
import { processDayRaces } from './processor.mjs';
import { insertCourses } from './db.mjs';
import { formatDate } from '../utils/dateUtils.mjs';
import { forecastQuantumProgram } from './quantum_predictions.mjs';

/**
 * SYNC MANAGER v27.2
 * Centralise la logique de synchronisation multi-jours et live.
 */
async function runSyncHistory(startDate, days = 1, onProgress = null) {
    if (!Number.isSafeInteger(days) || days < 1 || days > 3650) {
        throw new RangeError('Le nombre de jours doit être un entier compris entre 1 et 3650.');
    }
    const results = {
        totalDays: days,
        successfulDays: 0,
        totalCourses: 0,
        errors: []
    };

    // Date-only inputs are calendar dates; anchor them at UTC noon to avoid
    // shifting to the previous/next day on hosts in another timezone.
    const isDateOnly = typeof startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(startDate);
    const targetDate = isDateOnly
        ? new Date(`${startDate}T12:00:00.000Z`)
        : (startDate ? new Date(startDate) : new Date());
    if (!Number.isFinite(targetDate.getTime())
        || (isDateOnly && targetDate.toISOString().slice(0, 10) !== startDate)) {
        throw new TypeError('La date de début de synchronisation est invalide.');
    }

    for (let i = 0; i < days; i++) {
        const current = new Date(targetDate);
        current.setUTCDate(current.getUTCDate() - i);
        const dateStr = formatDate(current);
        let dayCount = 0;

        try {
            logger.info(`[SYNC MANAGER] Sync [${i + 1}/${days}] - ${dateStr}`);
            const data = await fetchDay(current);

            if (Array.isArray(data?.programme?.reunions)) {
                const processed = await processDayRaces(data, current);
                dayCount = await insertCourses(processed);
                results.totalCourses += dayCount;
                results.successfulDays++;
                if (dateStr === formatDate(new Date())) {
                    try {
                        results.quantumPredictions = await forecastQuantumProgram(dateStr);
                        logger.info(`[SYNC MANAGER] Prévisions ordonnées: ${results.quantumPredictions.forecasted_courses} courses.`);
                    } catch (error) {
                        results.quantumPredictionError = error.message;
                        logger.warn(`[SYNC MANAGER] Prévision Quantic indisponible: ${error.message}`);
                    }
                }
                logger.info(`[SYNC MANAGER] OK: ${dateStr} - ${dayCount} courses synchronisées.`);
            } else {
                logger.warn(`[SYNC MANAGER] No data for ${dateStr}`);
                results.errors.push({ date: dateStr, error: 'Aucune donnée PMU valide reçue.' });
            }
        } catch (error) {
            logger.error(`[SYNC MANAGER] Error for ${dateStr}: ${error.message}`);
            results.errors.push({ date: dateStr, error: error.message });
        }

        if (typeof onProgress === 'function') {
            try {
                onProgress({
                    currentDay: i + 1,
                    totalDays: days,
                    date: dateStr,
                    dayCourses: dayCount,
                    totalCourses: results.totalCourses,
                    percent: Math.round(((i + 1) / days) * 100)
                });
            } catch (err) {
                logger.error(`[SYNC MANAGER] Progress callback error: ${err.message}`);
            }
        }
    }

    return results;
}

let activeSyncs = 0;
const syncIdleWaiters = new Set();

export async function syncHistory(startDate, days = 1, onProgress = null) {
    activeSyncs++;
    try {
        return await runSyncHistory(startDate, days, onProgress);
    } finally {
        activeSyncs--;
        if (activeSyncs === 0) {
            for (const resolve of syncIdleWaiters) resolve();
            syncIdleWaiters.clear();
        }
    }
}

export async function waitForSyncIdle() {
    if (activeSyncs === 0) return;
    await new Promise(resolve => syncIdleWaiters.add(resolve));
}

/**
 * Live Sync: Récupère les mises à jour pour aujourd'hui (et optionnellement demain)
 * @param {boolean} includeTomorrow - Si true, synchronise aussi le programme de demain s'il est déjà disponible
 */
export async function syncLive(includeTomorrow = false) {
    const todayResults = await syncHistory(new Date(), 1);

    if (includeTomorrow) {
        const tomorrow = new Date(`${formatDate(new Date())}T12:00:00.000Z`);
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        try {
            logger.info(`[SYNC MANAGER] Sync anticipée pour demain (${formatDate(tomorrow)})...`);
            const tomorrowResults = await syncHistory(tomorrow, 1);
            todayResults.totalCourses += tomorrowResults.totalCourses;
            todayResults.successfulDays += tomorrowResults.successfulDays;
            todayResults.errors.push(...tomorrowResults.errors);
        } catch (err) {
            logger.warn(`[SYNC MANAGER] Impossibilité de sync demain: ${err.message}`);
            todayResults.errors.push({ date: formatDate(tomorrow), error: err.message });
        }
    }

    return todayResults;
}
