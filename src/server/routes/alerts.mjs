import { Router } from 'express';
import * as alertController from '../controllers/alertController.mjs';

const router = Router();

router.get('/', alertController.getAlerts);
router.get('/history', alertController.getHistory);
router.post('/dismiss/:id', alertController.dismiss);
router.post('/dismiss-all', alertController.dismissAll);
router.post('/read/:id', alertController.markRead);
router.post('/generate', alertController.generate);

// WebSocket Broadcast endpoint for external scripts
router.post('/broadcast', (req, res) => {
    const io = req.app.get('io');
    const { eventName, payload } = req.body || {};
    const allowedEvents = new Set(['sync_update', 'sync_progress', 'sync_completed', 'value_opportunity_alert']);
    
    if (!allowedEvents.has(eventName)) {
        return res.status(400).json({ success: false, error: 'Unsupported eventName' });
    }

    if (io) {
        io.emit(eventName, payload);
        res.json({ success: true, emitted: true });
    } else {
        res.status(400).json({ success: false, error: 'Missing io or eventName' });
    }
});

router.get('/telegram/status', alertController.getTelegramStatus);
router.post('/telegram/config', alertController.configureTelegram);
router.post('/telegram/test', alertController.testTelegram);

export default router;
