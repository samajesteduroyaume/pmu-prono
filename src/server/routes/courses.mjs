import { Router } from 'express';
import * as courseController from '../controllers/courseController.mjs';
import { validate } from '../middleware/validate.mjs';
import { getCoursesQuerySchema, courseIdParamSchema } from '../validators/courseValidator.mjs';

const router = Router();

router.get('/pepites', courseController.getPepites);
router.get('/pepites/performance', courseController.getPerformanceStats);
router.get('/quinte/prediction', courseController.getQuintePrediction);
router.get('/:id/participants', validate(courseIdParamSchema, 'params'), courseController.getParticipants);
router.get('/:id/details', validate(courseIdParamSchema, 'params'), courseController.getCourseDetails);
router.get('/', validate(getCoursesQuerySchema, 'query'), courseController.getCourses);

export default router;
