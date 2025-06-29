import { fetchDay, initBrowser, closeBrowser } from '../core/fetcher.mjs';
import { processDayRaces } from '../core/processor.mjs';
import { initDB, insertCourses, closeDB, getAllCourses } from '../core/db.mjs';
import { CONFIG } from '../config/settings.mjs';
import { getDaysForLastMonths, formatDate, calculateProgress } from '../utils/dateUtils.mjs';
import logger from '../utils/logger.mjs';

// === Paramètres ===
const FILTER_OPTIONS = {
    disciplines: ['TROT', 'PLAT', 'OBSTACLE', 'STEEPLECHASE', 'HAIE', 'MONTE', 'ATTELE']
};

// Génère tous les jours pour les 4 derniers mois
function getDaysForLast4Months() {
    const days = [];
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    
    // Calculer le mois de début (4 mois en arrière)
    let startMonth = currentMonth - 3;
    let startYear = currentYear;
    
    if (startMonth < 0) {
        startMonth += 12;
        startYear -= 1;
    }
    
    let date = new Date(startYear, startMonth, 1);
    
    while (date <= today) {
        days.push(new Date(date));
        date.setDate(date.getDate() + 1);
    }
    return days;
}

(async () => {
    const today = new Date();
    logger.header('PIPELINE 4 MOIS');
    logger.info(`Période: 4 derniers mois jusqu'à ${today.getMonth() + 1}/${today.getFullYear()}`);
    
    await initDB();
    await initBrowser();
    try {
        const days = getDaysForLastMonths(4);
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