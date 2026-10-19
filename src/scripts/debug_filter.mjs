import { fetchDay, initBrowser, closeBrowser } from '../core/fetcher.mjs';
import { processDayRaces } from '../core/processor.mjs';
import { initDB, closeDB } from '../db/db.mjs';
import { CONFIG } from '../config/settings.mjs';
import logger from '../utils/logger.mjs';
import { isMainModule } from '../utils/isMainModule.mjs';

async function debugFilter() {
    logger.header('DEBUG FILTRE');
    
    try {
        await initDB();
        await initBrowser();
        const testDate = new Date();
        logger.info(`Test avec la date: ${testDate.toISOString().split('T')[0]}`);
        
        const rawData = await fetchDay(testDate);
        
        if (rawData && rawData.programme) {
            const reunions = rawData.programme.reunions || [];
            const allRaces = reunions.flatMap(r => r.courses || []);
            
            logger.info(`Données brutes: ${allRaces.length} courses`);
            
            // Test du traitement
            const processedRaces = await processDayRaces(rawData, testDate, CONFIG.filters);
            logger.info(`Après traitement: ${processedRaces.length} courses`);
            
            if (processedRaces.length > 0) {
                logger.info('Exemple de course traitée:');
                logger.table(processedRaces[0]);
                
                // Analyse par discipline
                const byDiscipline = processedRaces.reduce((acc, c) => {
                    acc[c.discipline] = (acc[c.discipline] || 0) + 1;
                    return acc;
                }, {});
                
                logger.info('Répartition par discipline:');
                logger.table(byDiscipline);
            } else {
                logger.warning('Aucune course valide après traitement');
                
                // Debug des données brutes
                if (allRaces.length > 0) {
                    logger.info('Exemple de course brute:');
                    logger.table(allRaces[0]);
                }
            }
        } else {
            logger.warning('Aucune donnée reçue');
        }
        
    } catch (error) {
        logger.error(`Erreur: ${error.message}`);
        process.exitCode = 1;
    } finally {
        await closeDB();
        await closeBrowser();
        logger.info('Debug terminé');
    }
}

if (isMainModule(import.meta.url)) debugFilter();

export { debugFilter };
