import { Router } from 'express';
import * as courseController from '../controllers/courseController.mjs';

const router = Router();

router.get('/', courseController.getCourses);
router.get('/:id/participants', courseController.getParticipants);
router.get('/quinte/prediction', courseController.getQuintePrediction);

export default router;
