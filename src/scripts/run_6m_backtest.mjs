import { format, subMonths } from 'date-fns';
import fs from 'node:fs';
import logger from '../utils/logger.mjs';
import { initDB, closeDB } from '../core/db.mjs';
import { getForecastEvaluation } from '../core/forecast_evaluation.mjs';
import { isMainModule } from '../utils/isMainModule.mjs';

async function main() {
    const today = new Date();
    const startDate = format(subMonths(today, 6), 'yyyy-MM-dd');
    const endDate = format(today, 'yyyy-MM-dd');
    const reportPath = './data/prospective_evaluation_6m.json';

    try {
        await initDB();
        const evaluation = await getForecastEvaluation({ startDate, endDate });
        fs.mkdirSync('./data', { recursive: true });
        fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), ...evaluation }, null, 2));
        logger.header('ÉVALUATION PROSPECTIVE (6 MOIS)');
        logger.info(`Courses capturées avant le départ : ${evaluation.quality.capturedCourses}`);
        logger.info(`Courses réglées : ${evaluation.quality.settledCourses}`);
        logger.info(`Courses historiques sans snapshot : ${evaluation.quality.legacyFinishedCoursesWithoutSnapshot}`);
        logger.success(`Rapport généré : ${reportPath}`);
    } finally {
        await closeDB();
    }
}

if (isMainModule(import.meta.url)) {
    main().catch(error => {
        logger.error(`Erreur évaluation : ${error.message}`);
        process.exitCode = 1;
    });
}

export { main };
