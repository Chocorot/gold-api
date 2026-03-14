import { Router, Request, Response } from 'express';
import { goldService } from '../../services/gold.service';

const router = Router();

// Called by external scheduler every 2 minutes.
// Checks internally whether enough time has passed before hitting Twelve Data.
router.post('/fetch', async (req: Request, res: Response) => {
    await goldService.fetchAndStore();
    res.sendStatus(200);
});

export default router;
