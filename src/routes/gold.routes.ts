import { Router, Request, Response } from 'express';
import { goldService } from '../services/gold.service';
import { goldHistoryService } from '../services/gold.history.service';

const router = Router();

router.get('/', (req: Request, res: Response) => {
    const data = goldService.getLatestPrice();
    if (!data) {
        res.status(503).json({ error: 'Service initializing, try again shortly.' });
        return;
    }
    res.json(data);
});

// ?range=1h|5h|1d|5d|1w|1m|3m|6m|ytd|1y|2y|5y|10y (defaults to 1m)
router.get('/history', async (req: Request, res: Response) => {
    const range = typeof req.query.range === 'string' ? req.query.range : '1m';
    const data = await goldHistoryService.getHistory(range);
    res.json(data);
});

export default router;
