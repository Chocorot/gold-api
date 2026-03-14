import { Router, Request, Response } from 'express';
import { goldService } from '../../services/gold.service';
import { goldHistoryService, IntervalKey } from '../../services/gold.history.service';

const router = Router();

// --- Real-time price (every 2 min) -------------------------------------------
router.post('/fetch', async (req: Request, res: Response) => {
    await goldService.fetchAndStore();
    res.sendStatus(200);
});

// --- OHLC schedulers (only fetch candles newer than what is stored) -----------

// Run daily (e.g. every day at 23:59 UTC)
router.post('/fetch-daily', async (req: Request, res: Response) => {
    await goldHistoryService.fetchMissing('daily');
    res.sendStatus(200);
});

// Run weekly (e.g. every Monday at 00:01 UTC)
router.post('/fetch-weekly', async (req: Request, res: Response) => {
    await goldHistoryService.fetchMissing('weekly');
    res.sendStatus(200);
});

// Run monthly (e.g. 1st of every month at 00:01 UTC)
router.post('/fetch-monthly', async (req: Request, res: Response) => {
    await goldHistoryService.fetchMissing('monthly');
    res.sendStatus(200);
});

// --- Backfill (manual, run until response shows { done: true }) ---------------
// Body: { "interval": "daily" | "weekly" | "monthly" }
router.post('/backfill', async (req: Request, res: Response) => {
    const interval = req.body?.interval as IntervalKey;
    if (!['daily', 'weekly', 'monthly'].includes(interval)) {
        res.status(400).json({ error: 'interval must be "daily", "weekly", or "monthly"' });
        return;
    }
    const result = await goldHistoryService.backfill(interval);
    res.json(result);
});

export default router;

