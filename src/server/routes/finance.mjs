import { Router } from 'express';
import * as financeController from '../controllers/financeController.mjs';

const router = Router();

router.get('/', financeController.getPortfolio);
router.post('/', financeController.postPortfolio);
router.get('/shadow', financeController.getShadowPerformanceStats);

export default router;
