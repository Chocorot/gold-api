import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

export function privateAuth(req: Request, res: Response, next: NextFunction): void {
    const provided = req.headers['x-api-key'];

    if (!config.internalApiKey || provided !== config.internalApiKey) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    next();
}
