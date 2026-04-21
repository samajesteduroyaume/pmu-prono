import { getBankroll, updateBankroll, getShadowPerformance } from '../../core/db.mjs';
import { portfolioUpdateSchema } from '../validators/syncValidator.mjs';
import logger from '../../utils/logger.mjs';

export async function getPortfolio(req, res) {
    try {
        const shadow = await getBankroll('shadow');
        const reel = await getBankroll('reel');
        res.json({ shadow, reel });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

export async function postPortfolio(req, res) {
    try {
        const validation = portfolioUpdateSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({ success: false, error: 'Validation failed', details: validation.error.format() });
        }
        
        const { type, amount } = validation.data;
        await updateBankroll(type, amount);
        res.json({ success: true, message: `Bankroll ${type} updated by ${amount}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

export async function getShadowPerformanceStats(req, res) {
    try {
        const stats = await getShadowPerformance();
        res.json(stats);
    } catch (error) {
        logger.error(`API Shadow Performance Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}
