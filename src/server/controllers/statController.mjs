import { getIAPerformanceStats, getAdvancedStats, getPalmaresStats } from '../../core/db.mjs';
import logger from '../../utils/logger.mjs';

export async function getPerformance(req, res) {
    try {
        const { days } = req.query;
        logger.info(`API: Requête /api/performance (Filtre: ${days || 'TOUT'})`);
        const stats = await getIAPerformanceStats(days ? parseInt(days) : null);
        res.json(stats);
    } catch (error) {
        logger.error(`API Error Performance: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export async function getAdvanced(req, res) {
    try {
        logger.info('API: Requête /api/performance/advanced');
        const stats = await getAdvancedStats();
        res.json(stats);
    } catch (error) {
        logger.error(`API Error Advanced Stats: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export async function getPalmares(req, res) {
    try {
        logger.info('API: Requête /api/palmares');
        const stats = await getPalmaresStats();
        res.json(stats);
    } catch (error) {
        logger.error(`API Error Palmarès: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}
