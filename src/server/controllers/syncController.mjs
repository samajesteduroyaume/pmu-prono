import { syncHistory, syncLive } from '../../core/sync_manager.mjs';
import { syncSchema } from '../validators/syncValidator.mjs';
import logger from '../../utils/logger.mjs';

export async function sync(req, res) {
    try {
        const validation = syncSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({ success: false, error: 'Validation failed', details: validation.error.format() });
        }
        
        const { date, days } = validation.data;
        const results = await syncHistory(date, days);
        res.json({
            success: true,
            count: results.totalCourses,
            daysProcessed: results.successfulDays,
            errors: results.errors
        });
    } catch (error) {
        logger.error(`API Sync Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export async function syncLiv(req, res) {
    try {
        const results = await syncLive();
        res.json({ success: true, count: results.totalCourses, date: new Date().toISOString().split('T')[0] });
    } catch (e) {
        logger.error(`Live Sync Error: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
}
