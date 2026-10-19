import { initDB, closeDB, getPerformanceParDiscipline } from '../core/db.mjs';
import logger from '../utils/logger.mjs';
import { isMainModule } from '../utils/isMainModule.mjs';

async function analyzeDisciplines(days = 90) {
    try {
        if (!Number.isSafeInteger(days) || days < 1 || days > 3650) {
            throw new Error('Le nombre de jours doit être un entier compris entre 1 et 3650.');
        }
        await initDB();
        logger.header(`ANALYSE DES PERFORMANCES PAR DISCIPLINE (${days} JOURS)`);
        const stats = await getPerformanceParDiscipline(days);
        console.table(Object.entries(stats).map(([discipline, data]) => ({
            Discipline: discipline,
            Courses: data.total_courses,
            Victoires: data.wins,
            'Win Rate (%)': `${data.win_rate}%`,
            'ROI (%)': `${data.roi}%`
        })));
    } catch (error) {
        logger.error(`Erreur analyse : ${error.message}`);
        process.exitCode = 1;
    } finally {
        await closeDB();
    }
}

if (isMainModule(import.meta.url)) {
    const rawDays = process.argv[2];
    const days = rawDays === undefined ? 90 : Number(rawDays);
    analyzeDisciplines(days).catch(error => {
        logger.error(`Erreur fatale analyse : ${error.message}`);
        process.exitCode = 1;
    });
}

export { analyzeDisciplines };
