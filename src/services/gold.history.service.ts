import axios from 'axios';
import { Timestamp } from 'firebase-admin/firestore';
import db from '../db/firestore';
import { config } from '../config';
import { GoldCandle, GoldPricePoint, GoldTradingDayData } from '../types/gold.types';

export type IntervalKey = 'daily' | 'weekly' | 'monthly';

const INTERVAL_CONFIG: Record<IntervalKey, { collection: string; interval: string }> = {
    daily:   { collection: 'gold_ohlc_daily',   interval: '1day'   },
    weekly:  { collection: 'gold_ohlc_weekly',  interval: '1week'  },
    monthly: { collection: 'gold_ohlc_monthly', interval: '1month' },
};

const REALTIME_COLLECTION = 'gold_prices';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const PRICE_RANGE_MAP: Record<string, { windowMs: number; sampleMs?: number }> = {
    '1h': { windowMs: HOUR_MS },
    '5h': { windowMs: 5 * HOUR_MS },
    '1d': { windowMs: DAY_MS, sampleMs: 10 * MINUTE_MS },
    '5d': { windowMs: 5 * DAY_MS, sampleMs: 10 * MINUTE_MS },
    '1w': { windowMs: 7 * DAY_MS, sampleMs: 10 * MINUTE_MS },
    // User requested month view to use 2-hour sampling from realtime data.
    '1m': { windowMs: 30 * DAY_MS, sampleMs: 2 * HOUR_MS },
};

// Maps public ?range= param to the correct collection and lookback
const RANGE_MAP: Record<string, { key: IntervalKey; days: number | 'ytd' }> = {
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

    private realtimeCol() {
        return db.collection(REALTIME_COLLECTION);
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

    private downsamplePoints(points: GoldPricePoint[], sampleMs: number): GoldPricePoint[] {
        if (sampleMs <= 0) return points;

        const output: GoldPricePoint[] = [];
        let lastBucket = -1;

        for (const point of points) {
            const bucket = Math.floor(point.timestamp / sampleMs);
            if (bucket !== lastBucket) {
                output.push(point);
                lastBucket = bucket;
            }
        }

        return output;
    }

    private async getPriceHistory(windowMs: number, sampleMs?: number): Promise<GoldPricePoint[]> {
        const cutoffMs = Date.now() - windowMs;
        const cutoffTs = Timestamp.fromMillis(cutoffMs);

        const snapshot = await this.realtimeCol()
            .where('timestamp', '>=', cutoffTs)
            .orderBy('timestamp', 'asc')
            .get();

        const points = snapshot.docs.map((doc) => {
            const data = doc.data() as { timestamp: Timestamp | number; price: number };
            const timestamp = typeof data.timestamp === 'number'
                ? data.timestamp
                : data.timestamp.toMillis();

            return {
                timestamp,
                price: data.price,
            } as GoldPricePoint;
        });

        if (!sampleMs) return points;
        return this.downsamplePoints(points, sampleMs);
    }

    private getNYTradingDay(nowMs = Date.now()): { startMs: number, endMs: number, tradingDayStr: string } {
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            hourCycle: 'h23',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
        
        const parts = formatter.formatToParts(new Date(nowMs));
        const p = (type: string) => parts.find(x => x.type === type)!.value;
        const year = parseInt(p('year'));
        const month = parseInt(p('month')); // 1-12
        const day = parseInt(p('day'));
        const hour = parseInt(p('hour'));
        
        const nyDateObj = new Date(Date.UTC(year, month - 1, day));
        const dayOfWeek = nyDateObj.getUTCDay(); // 0-6

        let isClosed = false;
        if (dayOfWeek === 6) isClosed = true; // Saturday
        else if (dayOfWeek === 0 && hour < 18) isClosed = true; // Sunday before 6 PM
        else if (dayOfWeek === 5 && hour >= 17) isClosed = true; // Friday after 5 PM
        else if (hour === 17) isClosed = true; // Daily break Mon-Thu 5 PM - 6 PM

        const tradingDayNY = new Date(Date.UTC(year, month - 1, day));
        if (!isClosed) {
            if (hour >= 18) {
                tradingDayNY.setUTCDate(tradingDayNY.getUTCDate() + 1);
            }
        } else {
            if (dayOfWeek === 6) {
                tradingDayNY.setUTCDate(tradingDayNY.getUTCDate() - 1); // Sat -> Fri
            } else if (dayOfWeek === 0) {
                tradingDayNY.setUTCDate(tradingDayNY.getUTCDate() - 2); // Sun -> Fri
            } else if (dayOfWeek === 5 && hour >= 17) {
                // Friday after 5pm, the trading day that just ended was Friday
            } else if (hour === 17) {
                // daily break, the trading day that just ended was today
            }
        }

        const endYear = tradingDayNY.getUTCFullYear();
        const endMonth = tradingDayNY.getUTCMonth();
        const endDate = tradingDayNY.getUTCDate();
        
        const startObj = new Date(Date.UTC(endYear, endMonth, endDate - 1));
        const startYear = startObj.getUTCFullYear();
        const startMonth = startObj.getUTCMonth();
        const startDateObjDay = startObj.getUTCDate();
        
        const getUtcMs = (y: number, m: number, d: number, h: number) => {
            const tryEdtStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00.000-04:00`;
            const dateEdt = new Date(tryEdtStr);
            const tf = formatter.formatToParts(dateEdt);
            const tryH = parseInt(tf.find(x => x.type === 'hour')!.value);
            if (tryH === h) return dateEdt.getTime();
            
            const tryEstStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00.000-05:00`;
            return new Date(tryEstStr).getTime();
        };

        const startMs = getUtcMs(startYear, startMonth, startDateObjDay, 18);
        const endMs = getUtcMs(endYear, endMonth, endDate, 17);
        const tradingDayStr = `${endYear}-${String(endMonth + 1).padStart(2, '0')}-${String(endDate).padStart(2, '0')}`;
        
        return { startMs, endMs, tradingDayStr };
    }

    async getTradingDayData(): Promise<GoldTradingDayData> {
        const { startMs, endMs, tradingDayStr } = this.getNYTradingDay(Date.now());

        const startTs = Timestamp.fromMillis(startMs);
        const endTs = Timestamp.fromMillis(endMs);

        const snapshot = await this.realtimeCol()
            .where('timestamp', '>=', startTs)
            .where('timestamp', '<', endTs)
            .orderBy('timestamp', 'asc')
            .get();

        const points: GoldPricePoint[] = snapshot.docs.map((doc) => {
            const data = doc.data() as { timestamp: Timestamp | number; price: number };
            const timestamp = typeof data.timestamp === 'number'
                ? data.timestamp
                : data.timestamp.toMillis();

            return {
                timestamp,
                price: data.price,
            };
        });

        const previousSessionMs = startMs - 1000;
        const prevSession = this.getNYTradingDay(previousSessionMs);
        const previousDate = prevSession.tradingDayStr;

        const previousDaySnap = await this.col('daily').doc(previousDate).get();

        let previousClose: number | null = null;
        if (previousDaySnap.exists) {
            const previousDayData = previousDaySnap.data() as GoldCandle;
            previousClose = previousDayData.close;
        } else {
            const fallbackSnap = await this.realtimeCol()
                .where('timestamp', '<', startTs)
                .orderBy('timestamp', 'desc')
                .limit(1)
                .get();

            if (!fallbackSnap.empty) {
                const fallback = fallbackSnap.docs[0].data() as { price: number };
                previousClose = fallback.price;
            }
        }

        const prices = points.map((point) => point.price);
        const high = prices.length ? Math.max(...prices) : null;
        const low = prices.length ? Math.min(...prices) : null;

        return {
            tradingDay: tradingDayStr,
            previousClose,
            high,
            low,
            points,
        };
    }

    // -------------------------------------------------------------------------
    // Public read: returns historical series sorted oldest → newest.
    // Realtime ranges come from 2-minute price data, longer ranges from OHLC.
    // -------------------------------------------------------------------------
    async getHistory(range: string = '1m'): Promise<Array<GoldPricePoint | GoldCandle>> {
        const priceRange = PRICE_RANGE_MAP[range];
        if (priceRange) {
            return this.getPriceHistory(priceRange.windowMs, priceRange.sampleMs);
        }

        const mapping = RANGE_MAP[range] ?? RANGE_MAP['3m'];
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

