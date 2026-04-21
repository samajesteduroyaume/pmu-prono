import { Router } from 'express';
import * as tuningController from '../controllers/tuningController.mjs';

const router = Router();

router.post('/optimize', tuningController.optimize);
router.get('/status', tuningController.getStatus);

export default router;
