import { format } from 'date-fns';
import { fetchCourseRapports } from '../core/fetcher.mjs';
import { getDB, initDB, closeDB } from '../db/db.mjs';
import logger from '../utils/logger.mjs';

async function syncRapports(startDate, endDate) {
    await initDB();
    const db = getDB();

    logger.header(`SYNC RAPPORTS : ${startDate} au ${endDate}`);

    const courses = await new Promise((resolve) => {
        db.all(`
            SELECT id, date, reunionNum, courseNum 
            FROM courses 
            WHERE date BETWEEN ? AND ? 
              AND (rapports IS NULL OR rapports = 'null' OR rapports = '')
              AND ordre_arrivee IS NOT NULL
        `, [startDate, endDate], (err, rows) => resolve(rows || []));
    });

    logger.info(`${courses.length} courses nécessitent une mise à jour des rapports.`);

    for (let i = 0; i < courses.length; i++) {
        const c = courses[i];
        const dateStr = format(new Date(c.date), 'ddMMyyyy');
        
        try {
            logger.info(`[${i+1}/${courses.length}] Fetching rapports for R${c.reunionNum}C${c.courseNum} on ${c.date}...`);
            const rapports = await fetchCourseRapports(dateStr, c.reunionNum, c.courseNum);
            
            if (rapports) {
                await new Promise((resolve) => {
                    db.run("UPDATE courses SET rapports = ? WHERE id = ?", [JSON.stringify(rapports), c.id], resolve);
                });
            }
            // Anti-spam PMU
            await new Promise(r => setTimeout(r, 500));
        } catch (err) {
            logger.error(`Erreur R${c.reunionNum}C${c.courseNum} : ${err.message}`);
        }
    }

    await closeDB();
}

const start = process.argv[2] || '2026-03-27';
const end = process.argv[3] || '2026-04-27';
syncRapports(start, end);
