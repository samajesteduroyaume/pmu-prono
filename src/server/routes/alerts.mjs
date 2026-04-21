import { Router } from 'express';
import * as alertController from '../controllers/alertController.mjs';

const router = Router();

router.get('/', alertController.getAlerts);
router.get('/history', alertController.getHistory);
router.post('/dismiss/:id', alertController.dismiss);
router.post('/dismiss-all', alertController.dismissAll);
router.post('/read/:id', alertController.markRead);
router.get('/generate', alertController.generate);

export default router;
