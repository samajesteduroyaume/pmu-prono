import assert from 'node:assert/strict';
import { initBrowser, closeBrowser, fetchDay } from '../core/fetcher.mjs';
import logger from '../utils/logger.mjs';

async function testConnection() {
    logger.header('TEST DE CONNEXION PMU');
    try {
        await initBrowser();
        logger.success('Navigateur initialisé');
        const testDate = new Date();
        logger.info(`Test avec la date: ${testDate.toISOString().split('T')[0]}`);
        const data = await fetchDay(testDate);
        assert.ok(data?.programme && Array.isArray(data.programme.reunions), 'Réponse programme PMU absente ou invalide.');
        const reunions = data.programme.reunions;
        const totalCourses = reunions.reduce((sum, reunion) => sum + (reunion.courses?.length || 0), 0);
        logger.success('Connexion PMU réussie.');
        logger.info(`Réunions trouvées: ${reunions.length}`);
        logger.info(`Courses totales: ${totalCourses}`);
        if (reunions.length) {
            logger.info('Première réunion:');
            logger.table({ hippodrome: reunions[0].hippodrome, courses: reunions[0].courses?.length || 0 });
        }
    } catch (error) {
        logger.error(`Erreur de connexion: ${error.message}`);
        throw error;
    } finally {
        await closeBrowser();
        logger.info('Test terminé.');
    }
}

testConnection().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
