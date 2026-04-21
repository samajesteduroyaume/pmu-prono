import { Router } from 'express';
import * as syncController from '../controllers/syncController.mjs';

const router = Router();

router.post('/', syncController.sync);
router.get('/live', syncController.syncLiv);

export default router;
