import { fetchCourseRapports } from '../core/fetcher.mjs';
import { getDB, initDB, closeDB } from '../db/db.mjs';
import { formatDate } from '../utils/dateUtils.mjs';
import logger from '../utils/logger.mjs';
import { isMainModule } from '../utils/isMainModule.mjs';

function isCalendarDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

async function syncRapports(startDate, endDate) {
    await initDB();
    const db = getDB();
    try {
        logger.header(`SYNC RAPPORTS : ${startDate} au ${endDate}`);

        const courses = await new Promise((resolve, reject) => {
            db.all(`
                SELECT id, date, reunionNum, courseNum
                FROM courses
                WHERE date BETWEEN ? AND ?
                  AND (rapports IS NULL OR rapports = 'null' OR rapports = '')
                  AND COALESCE(ordre_arrivee, '') <> ''
                  AND UPPER(COALESCE(statut, '')) IN ('ARRIVEE_DEFINITIVE_COMPLETE', 'ARRIVE_DEFINITIVE')
            `, [startDate, endDate], (error, rows) => error ? reject(error) : resolve(rows || []));
        });

        logger.info(`${courses.length} courses nécessitent une mise à jour des rapports.`);

        let failures = 0;
        for (let i = 0; i < courses.length; i++) {
            const course = courses[i];
            const dateStr = formatDate(course.date).split('-').reverse().join('');
            try {
                logger.info(`[${i + 1}/${courses.length}] Récupération des rapports de R${course.reunionNum}C${course.courseNum} (${course.date})...`);
                const rapports = await fetchCourseRapports(dateStr, course.reunionNum, course.courseNum);
                if (rapports) {
                    await new Promise((resolve, reject) => {
                        db.run('UPDATE courses SET rapports = ? WHERE id = ?', [JSON.stringify(rapports), course.id], error => error ? reject(error) : resolve());
                    });
                } else {
                    failures++;
                    logger.warn(`Aucun rapport reçu pour R${course.reunionNum}C${course.courseNum}.`);
                }
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                failures++;
                logger.error(`Erreur R${course.reunionNum}C${course.courseNum} : ${error.message}`);
            }
        }
        if (failures > 0) {
            logger.warn(`${failures}/${courses.length} courses n'ont pas été mises à jour.`);
            process.exitCode = 1;
        } else {
            logger.success(`${courses.length} courses mises à jour avec les rapports disponibles.`);
        }
    } finally {
        await closeDB();
    }
}

if (isMainModule(import.meta.url)) {
    const today = formatDate(new Date());
    const defaultStart = formatDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
    const start = process.argv[2] || defaultStart;
    const end = process.argv[3] || today;
    if (!isCalendarDate(start) || !isCalendarDate(end) || start > end) {
        console.error('Période invalide. Format attendu : YYYY-MM-DD YYYY-MM-DD.');
        process.exitCode = 1;
    } else {
        syncRapports(start, end).catch(error => {
            logger.error(`Échec de synchronisation des rapports : ${error.message}`);
            process.exitCode = 1;
        });
    }
}

export { syncRapports };
