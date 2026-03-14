import { Router } from 'express';
import goldRouter from './gold.routes';
import internalRouter from './internal';

const router = Router();

// Public endpoints
router.use('/gold', goldRouter);
// router.use('/silver', silverRouter);
// router.use('/portfolio', portfolioRouter);

// Private endpoints (require x-api-key header)
router.use('/internal', internalRouter);

export default router;
