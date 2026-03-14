import axios from 'axios';
import db from '../db/firestore';
import { config } from '../config';
import { GoldCandle } from '../types/gold.types';

export type IntervalKey = 'daily' | 'weekly' | 'monthly';

const INTERVAL_CONFIG: Record<IntervalKey, { collection: string; interval: string }> = {
    daily:   { collection: 'gold_ohlc_daily',   interval: '1day'   },
    weekly:  { collection: 'gold_ohlc_weekly',  interval: '1week'  },
    monthly: { collection: 'gold_ohlc_monthly', interval: '1month' },
};

// Maps public ?range= param to the correct collection and lookback
const RANGE_MAP: Record<string, { key: IntervalKey; days: number | 'ytd' }> = {
    '1m':   { key: 'daily',   days: 30   },
    '3m':   { key: 'daily',   days: 90   },
    '6m':   { key: 'daily',   days: 180  },
    'ytd':  { key: 'daily',   days: 'ytd' },
    '1y':   { key: 'weekly',  days: 365  },
    '2y':   { key: 'weekly',  days: 730  },
    '5y':   { key: 'monthly', days: 1825 },
    '10y':  { key: 'monthly', days: 3650 },
};

class GoldHistoryService {
    private col(key: IntervalKey) {
        return db.collection(INTERVAL_CONFIG[key].collection);
    }

    // -------------------------------------------------------------------------
    // Called by schedulers. Only fetches candles newer than what is stored.
    // Re-fetches the latest stored date so in-progress periods stay fresh.
    // -------------------------------------------------------------------------
    async fetchMissing(key: IntervalKey): Promise<void> {
        const latestSnap = await this.col(key)
            .orderBy('date', 'desc')
            .limit(1)
            .get();

        let startDate: string | undefined;
        if (!latestSnap.empty) {
            startDate = (latestSnap.docs[0].data() as GoldCandle).date;
            console.log(`[GoldHistoryService:${key}] Fetching from ${startDate} onwards...`);
        } else {
            console.log(`[GoldHistoryService:${key}] No data yet — fetching most recent 5000 candles...`);
        }

        await this.fetchAndStore(key, { outputsize: 5000, startDate });
    }

    // -------------------------------------------------------------------------
    // Backfill: extends history backwards by 5000 candles per call.
    // Repeat until { done: true }.
    // -------------------------------------------------------------------------
    async backfill(key: IntervalKey): Promise<{ done: boolean; stored: number; oldestDate: string | null }> {
        const oldestSnap = await this.col(key)
            .orderBy('date', 'asc')
            .limit(1)
            .get();

        let endDate: string | undefined;
        if (!oldestSnap.empty) {
            const oldest = (oldestSnap.docs[0].data() as GoldCandle).date;
            const d = new Date(oldest + 'T00:00:00Z');
            d.setUTCDate(d.getUTCDate() - 1);
            endDate = d.toISOString().split('T')[0];
            console.log(`[GoldHistoryService:${key}] Backfilling before ${endDate}...`);
        } else {
            console.log(`[GoldHistoryService:${key}] No data — fetching most recent 5000 candles...`);
        }

        const stored = await this.fetchAndStore(key, { outputsize: 5000, endDate });
        return { done: stored === 0, stored, oldestDate: endDate ?? null };
    }

    // -------------------------------------------------------------------------
    // Core: calls Twelve Data and batch-upserts into the correct collection.
    // Normalises datetime to "YYYY-MM-DD" for consistent doc IDs across all
    // interval types (Twelve Data returns "YYYY-MM-DD HH:MM:SS" for weekly/monthly).
    // -------------------------------------------------------------------------
    private async fetchAndStore(
        key: IntervalKey,
        opts: { outputsize: number; startDate?: string; endDate?: string },
    ): Promise<number> {
        if (!config.twelveDataKey) {
            console.error('[GoldHistoryService] TWELVE_DATA_KEY is missing');
            return 0;
        }

        try {
            const params: Record<string, any> = {
                symbol:     'XAU/USD',
                interval:   INTERVAL_CONFIG[key].interval,
                outputsize: opts.outputsize,
                apikey:     config.twelveDataKey,
            };
            if (opts.startDate) params.start_date = opts.startDate;
            if (opts.endDate)   params.end_date   = opts.endDate;

            const response = await axios.get('https://api.twelvedata.com/time_series', { params });

            if (response.data.status !== 'ok') {
                throw new Error(`API error: ${response.data.message ?? 'unknown'}`);
            }

            const values: any[] = response.data.values;
            if (!values?.length) return 0;

            const col = this.col(key);
            const BATCH_SIZE = 500;
            for (let i = 0; i < values.length; i += BATCH_SIZE) {
                const batch = db.batch();
                for (const v of values.slice(i, i + BATCH_SIZE)) {
                    const dateKey = (v.datetime as string).substring(0, 10);
                    const candle: GoldCandle = {
                        date:  dateKey,
                        open:  parseFloat(v.open),
                        high:  parseFloat(v.high),
                        low:   parseFloat(v.low),
                        close: parseFloat(v.close),
                    };
                    batch.set(col.doc(dateKey), candle);
                }
                await batch.commit();
            }

            console.log(`[GoldHistoryService:${key}] Stored ${values.length} candles`);
            return values.length;
        } catch (err: any) {
            console.error(`[GoldHistoryService:${key}] Error: ${err.message}`);
            return 0;
        }
    }

    // -------------------------------------------------------------------------
    // Public read: returns OHLC candles for the requested range, oldest → newest.
    // Supported ranges: 1m  3m  6m  ytd  1y  2y  5y  10y
    // -------------------------------------------------------------------------
    async getHistory(range: string = '1m'): Promise<GoldCandle[]> {
        const mapping = RANGE_MAP[range] ?? RANGE_MAP['1m'];
        const col = this.col(mapping.key);

        let cutoffStr: string;
        if (mapping.days === 'ytd') {
            cutoffStr = `${new Date().getFullYear()}-01-01`;
        } else {
            const d = new Date();
            d.setDate(d.getDate() - mapping.days);
            cutoffStr = d.toISOString().split('T')[0];
        }

        const snapshot = await col
            .where('date', '>=', cutoffStr)
            .orderBy('date', 'asc')
            .get();

        return snapshot.docs.map(doc => doc.data() as GoldCandle);
    }
}

export const goldHistoryService = new GoldHistoryService();

