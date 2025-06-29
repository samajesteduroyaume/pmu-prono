import { initBrowser, closeBrowser, fetchDay } from '../core/fetcher.mjs';
import logger from '../utils/logger.mjs';

(async () => {
    logger.header('TEST DE CONNEXION PMU');
    
    try {
        await initBrowser();
        logger.success('Navigateur initialisé');
        
        const testDate = new Date();
        logger.info(`Test avec la date: ${testDate.toISOString().split('T')[0]}`);
        
        const data = await fetchDay(testDate);
        
        if (data && data.programme) {
            const reunions = data.programme.reunions || [];
            const totalCourses = reunions.reduce((sum, r) => sum + (r.courses?.length || 0), 0);
            
            logger.success(`Connexion réussie !`);
            logger.info(`Réunions trouvées: ${reunions.length}`);
            logger.info(`Courses totales: ${totalCourses}`);
            
            if (reunions.length > 0) {
                logger.info('Première réunion:');
                logger.table({
                    hippodrome: reunions[0].hippodrome,
                    courses: reunions[0].courses?.length || 0
                });
            }
        } else {
            logger.warning('Aucune donnée reçue');
        }
        
    } catch (error) {
        logger.error(`Erreur de connexion: ${error.message}`);
    } finally {
        await closeBrowser();
        logger.info('Test terminé');
    }
})(); 