import { getIAPerformanceStats, getAdvancedStats, getPalmaresStats, getEcuriesForm } from '../../core/db.mjs';
import logger from '../../utils/logger.mjs';
import { parseDays } from '../../utils/requestParams.mjs';

export async function getPerformance(req, res) {
    try {
        const { days } = req.query;
        const daysFilter = parseDays(days);
        if (daysFilter === undefined) return res.status(400).json({ error: 'Le paramètre days doit être un entier entre 1 et 3650.' });
        logger.info(`API: Requête /api/performance (Filtre: ${daysFilter ?? 'TOUT'})`);
        const stats = await getIAPerformanceStats(daysFilter);
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

export async function getEcuries(req, res) {
    try {
        const days = parseDays(req.query.days, 90);
        if (days === undefined) return res.status(400).json({ success: false, error: 'Le paramètre days doit être un entier entre 1 et 3650.' });
        logger.info('API: Requête /api/ecuries/compare');
        const data = await getEcuriesForm(days);
        res.json({ success: true, data });
    } catch (error) {
        logger.error(`API Error Ecuries: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
}
