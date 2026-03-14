import axios from 'axios';
import { Timestamp } from 'firebase-admin/firestore';
import db from '../db/firestore';
import { config } from '../config';
import { GoldRecord } from '../types/gold.types';

const COLLECTION = 'gold_prices';
// 1.9 minutes — absorbs minor scheduler jitter
const LOCK_WINDOW_MS = 114_000;

class GoldService {
    private cachedData: GoldRecord | null = null;
    private readonly collection = db.collection(COLLECTION);

    async warmUpCache(): Promise<void> {
        try {
            const snapshot = await this.collection
                .orderBy('timestamp', 'desc')
                .limit(1)
                .get();

            if (!snapshot.empty) {
                const data = snapshot.docs[0].data();
                this.cachedData = {
                    price: data.price,
                    timestamp: (data.timestamp as Timestamp).toMillis(),
                };
                console.log(`[GoldService] Cache warmed: $${this.cachedData.price}`);
            }
        } catch (err) {
            console.error('[GoldService] Failed to warm up cache:', err);
        }
    }

    async fetchAndStore(): Promise<void> {
        if (!config.twelveDataKey) {
            console.error('[GoldService] TWELVE_DATA_KEY is missing');
            return;
        }

        const now = Date.now();

        if (this.cachedData && now - this.cachedData.timestamp < LOCK_WINDOW_MS) {
            console.log('[GoldService] Within lock window, skipping fetch.');
            return;
        }

        try {
            console.log('[GoldService] Fetching gold price...');
            const response = await axios.get('https://api.twelvedata.com/price', {
                params: { symbol: 'XAU/USD', apikey: config.twelveDataKey },
            });

            const price = parseFloat(response.data.price);
            if (isNaN(price)) throw new Error('Invalid price in API response');

            const firestoreTimestamp = Timestamp.now();
            await this.collection.add({ price, timestamp: firestoreTimestamp });

            this.cachedData = { price, timestamp: firestoreTimestamp.toMillis() };
            console.log(`[GoldService] Stored: $${price}`);
        } catch (err: any) {
            console.error(`[GoldService] Fetch error: ${err.message}`);
        }
    }

    getLatestPrice(): GoldRecord | null {
        return this.cachedData;
    }
}

// Singleton export so all consumers share the same cache
export const goldService = new GoldService();
