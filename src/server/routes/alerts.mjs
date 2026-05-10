import { Router } from 'express';
import * as alertController from '../controllers/alertController.mjs';

const router = Router();

router.get('/', alertController.getAlerts);
router.get('/history', alertController.getHistory);
router.post('/dismiss/:id', alertController.dismiss);
router.post('/dismiss-all', alertController.dismissAll);
router.post('/read/:id', alertController.markRead);
router.get('/generate', alertController.generate);

// WebSocket Broadcast endpoint for external scripts
router.post('/broadcast', (req, res) => {
    const io = req.app.get('io');
    const { eventName, payload } = req.body;
    
    if (io && eventName) {
        io.emit(eventName, payload);
        res.json({ success: true, emitted: true });
    } else {
        res.status(400).json({ success: false, error: 'Missing io or eventName' });
    }
});

export default router;
