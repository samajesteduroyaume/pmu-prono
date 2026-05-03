import { Router } from 'express';
import * as courseController from '../controllers/courseController.mjs';

const router = Router();

router.get('/pepites', courseController.getPepites);
router.get('/pepites/performance', courseController.getPerformanceStats);
router.get('/quinte/prediction', courseController.getQuintePrediction);
router.get('/:id/participants', courseController.getParticipants);
router.get('/:id/details', courseController.getCourseDetails);
router.get('/', courseController.getCourses);

export default router;
