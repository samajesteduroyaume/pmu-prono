import { fetchDay, initBrowser, closeBrowser } from '../core/fetcher.mjs';
import { processDayRaces } from '../core/processor.mjs';
import { initDB, insertCourses, closeDB, getAllCourses } from '../core/db.mjs';
import { CONFIG } from '../config/settings.mjs';
import { generateDateRange, formatDate, calculateProgress } from '../utils/dateUtils.mjs';
import logger from '../utils/logger.mjs';

// === Paramètres ===
const DAYS_BACK = 7; // 7 derniers jours
const FILTER_OPTIONS = {
    disciplines: ['TROT', 'PLAT', 'OBSTACLE', 'STEEPLECHASE', 'HAIE', 'MONTE', 'ATTELE']
};

// Génère les 7 derniers jours de 2024
function getLast7DaysOf2024() {
    const days = [];
    const endDate = new Date(2024, 11, 31); // 31 décembre 2024
    
    for (let i = DAYS_BACK - 1; i >= 0; i--) {
        const date = new Date(endDate);
        date.setDate(endDate.getDate() - i);
        days.push(date);
    }
    return days;
}

(async () => {
    const today = new Date();
    logger.header('PIPELINE 1 SEMAINE');
    logger.info(`Période: 7 derniers jours jusqu'à ${today.getMonth() + 1}/${today.getFullYear()}`);
    
    await initDB();
    await initBrowser();
    try {
        const days = generateDateRange(7);
        let totalInserted = 0;
        let daysWithRaces = 0;
        
        logger.info(`Traitement de ${days.length} jours...`);
        
        for (let i = 0; i < days.length; i++) {
            const date = days[i];
            const dateStr = formatDate(date);
            
            logger.progress(i + 1, days.length, dateStr);
            
            try {
                const rawData = await fetchDay(date);
                const processedRaces = processDayRaces(rawData, date, CONFIG.filters);
                
                if (processedRaces.length > 0) {
                    await insertCourses(processedRaces);
                    totalInserted += processedRaces.length;
                    daysWithRaces++;
                    logger.success(`${processedRaces.length} courses insérées`);
                } else {
                    logger.warning('Aucune course valide pour cette date');
                }
                
            } catch (e) {
                logger.error(`Erreur pour ${dateStr}: ${e.message}`);
            }
        }
        
        logger.header('RÉSULTATS');
        logger.info(`Total de courses insérées: ${totalInserted.toLocaleString('fr-FR')}`);
        logger.info(`Jours avec courses: ${daysWithRaces}/${days.length}`);
        
        // Analyse rapide
        const allCourses = await getAllCourses();
        const byDiscipline = allCourses.reduce((acc, c) => {
            acc[c.discipline] = (acc[c.discipline] || 0) + 1;
            return acc;
        }, {});
        
        logger.info('Répartition par discipline:');
        logger.table(byDiscipline);
        
    } finally {
        await closeBrowser();
        await closeDB();
        logger.info('Pipeline terminé');
    }
})(); 