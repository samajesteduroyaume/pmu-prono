import { Router } from 'express';
import * as mlController from '../controllers/mlController.mjs';

const router = Router();

router.get('/tendances', mlController.getTendances);
router.get('/patterns', mlController.getPatterns);
router.get('/sequence', mlController.getSequence);
router.get('/value-hunter', mlController.valueHunter);
router.post('/backtest', mlController.backtest);
router.post('/backtest/compare', mlController.backtestCompare);
router.post('/backtest/monte-carlo', mlController.backtestMonteCarlo);
router.get('/patterns/optimized', mlController.getOptimizedPatterns);
router.post('/patterns/recommendations', mlController.getRecommendations);

export default router;
