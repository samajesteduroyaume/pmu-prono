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
        const io = req.app.get('io');

        if (days > 1) {
            // Lancement asynchrone en arrière-plan pour éviter tout timeout HTTP
            const jobId = `sync_${Date.now()}`;
            res.status(202).json({
                success: true,
                async: true,
                jobId,
                days,
                message: `Synchronisation de ${days} jour(s) démarrée en arrière-plan.`
            });

            // Exécution asynchrone avec émission WebSocket en temps réel
            (async () => {
                try {
                    const results = await syncHistory(date, days, (progress) => {
                        if (io) {
                            io.emit('sync_progress', { jobId, ...progress });
                        }
                    });
                    if (io) {
                        io.emit('sync_completed', { jobId, ...results });
                        io.emit('sync_update', { count: results.totalCourses, timestamp: new Date() });
                    }
                } catch (err) {
                    logger.error(`Async Sync Error (Job ${jobId}): ${err.message}`);
                    if (io) io.emit('sync_error', { jobId, error: err.message });
                }
            })();
        } else {
            // Synchronisation synchrone directe pour 1 seul jour (rapide)
            const results = await syncHistory(date, 1);
            res.json({
                success: true,
                count: results.totalCourses,
                daysProcessed: results.successfulDays,
                errors: results.errors
            });
        }
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
