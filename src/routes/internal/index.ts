import { Router } from 'express';
import { privateAuth } from '../../middleware/privateAuth';
import goldInternalRouter from './gold.routes';

const router = Router();

// All routes under /api/internal require a valid x-api-key header
router.use(privateAuth);

router.use('/gold', goldInternalRouter);
// router.use('/silver', silverInternalRouter);

export default router;
