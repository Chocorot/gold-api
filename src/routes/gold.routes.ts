import { Router, Request, Response } from 'express';
import { goldService } from '../services/gold.service';

const router = Router();

router.get('/', (req: Request, res: Response) => {
    const data = goldService.getLatestPrice();
    if (!data) {
        res.status(503).json({ error: 'Service initializing, try again shortly.' });
        return;
    }
    res.json(data);
});

export default router;
