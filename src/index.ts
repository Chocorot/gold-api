import express from 'express';
import axios from 'axios';
import cron from 'node-cron';
import dotenv from 'dotenv';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Timestamp, QueryDocumentSnapshot } from 'firebase-admin/firestore';

dotenv.config();

// Initialize Firestore
initializeApp({ credential: applicationDefault() });
const db = getFirestore();

interface GoldRecord {
    timestamp: number;
    price: number;
}

class GoldService {
    private readonly API_KEY = process.env.TWELVE_DATA_KEY;
    private cachedData: GoldRecord | null = null;
    private collection = db.collection('gold_prices');

    /**
     * Replaces the old initialize() logic.
     * Fetches the latest price from Firestore to warm up the cache.
     */
    async warmUpCache() {
        try {
            const snapshot = await this.collection
                .orderBy('timestamp', 'desc')
                .limit(1)
                .get();

            if (!snapshot.empty) {
                const data = snapshot.docs[0].data();
                this.cachedData = {
                    price: data.price,
                    timestamp: data.timestamp.toMillis() // Convert Firestore Timestamp to JS number
                };
                console.log(`[Init] Loaded last price: $${this.cachedData.price}`);
            }
        } catch (err) {
            console.error('[Init Error] Failed to warm up cache:', err);
        }
    }

    async safeFetch() {
        if (!this.API_KEY) {
            console.error('[Error] API Key missing in .env');
            return;
        }

        const now = Date.now();
        const currentMinute = new Date().getMinutes();

        // 1. Guard: Only even minutes
        if (currentMinute % 2 !== 0) return;

        // 2. Guard: 90-second lock using memory cache
        if (this.cachedData && (now - this.cachedData.timestamp) < 90000) {
            console.log('[Guard] Window already handled.');
            return;
        }

        try {
            console.log('[API] Requesting Gold Price...');
            const response = await axios.get('https://api.twelvedata.com/price', {
                params: { symbol: 'XAU/USD', apikey: this.API_KEY }
            });

            const price = parseFloat(response.data.price);
            if (isNaN(price)) throw new Error('Invalid price data');

            // 3. Save to Firestore
            const firestoreTimestamp = Timestamp.now();
            await this.collection.add({
                price: price,
                timestamp: firestoreTimestamp
            });

            this.cachedData = { 
                price, 
                timestamp: firestoreTimestamp.toMillis() 
            };
            console.log(`[Success] Saved to Firestore: $${price}`);

        } catch (error: any) {
            console.error(`[API Error] ${error.message}`);
        }
    }

    public getLatestPrice() {
        return this.cachedData;
    }
}

// --- Server Setup ---
const app = express();
const goldService = new GoldService();

app.get('/api/gold', (req, res) => {
    const data = goldService.getLatestPrice();
    if (!data) return res.status(503).json({ error: 'Initializing...' });
    res.json(data);
});

const start = async () => {
    await goldService.warmUpCache();
    
    // Start Cron
    cron.schedule('*/2 * * * *', () => goldService.safeFetch());
    
    // Immediate check for gaps on restart
    await goldService.safeFetch();

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`[Server] Firestore-API online on port ${PORT}`));
};

start();