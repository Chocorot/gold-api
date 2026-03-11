import express from 'express';
import axios from 'axios';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import cron from 'node-cron';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Interface for Gold Data
 */
interface GoldRecord {
    timestamp: number;
    price: number;
}

class GoldService {
    private db?: Database;
    private readonly API_KEY = process.env.TWELVE_DATA_KEY;
    private readonly DB_PATH = './gold_data.db';
    private readonly CACHE_DURATION_MS = 90000;
    private cachedData: GoldRecord | null = null;

    async initialize() {
        this.db = await open({
            filename: this.DB_PATH,
            driver: sqlite3.Database
        });

        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS gold_prices (
                timestamp INTEGER PRIMARY KEY,
                price REAL
            )
        `);

        // Load the most recent price into memory on startup
        const lastEntry = await this.db.get<GoldRecord>(
            'SELECT * FROM gold_prices ORDER BY timestamp DESC LIMIT 1'
        );
        if (lastEntry) {
            this.cachedData = lastEntry;
            console.log(`[Init] Loaded last price: $${lastEntry.price}`);
        }
    }

    async safeFetch() {
        if (!this.db || !this.API_KEY) {
            console.error('[Error] DB not initialized or API Key missing.');
            return;
        }

        const now = Date.now();
        const currentMinute = new Date().getMinutes();

        // 1. Guard: Only fetch on EVEN minutes
        if (currentMinute % 2 !== 0) {
            console.log(`[Guard] Skipping minute ${currentMinute} (not even)`);
            return;
        }

        // 2. Guard: Check if we already have data for this 2-minute window
        // We check if the last fetch was within the last 90 seconds
        if (this.cachedData && (now - this.cachedData.timestamp) < this.CACHE_DURATION_MS) {
            console.log('[Guard] Already fetched for this window. Standing down.');
            return;
        }

        // 3. API Request
        try {
            console.log('[API] Fetching new gold price...');
            const response = await axios.get('https://api.twelvedata.com/price', {
                params: { 
                    symbol: 'XAU/USD', 
                    apikey: this.API_KEY 
                }
            });

            const price = parseFloat(response.data.price);
            if (isNaN(price)) throw new Error('Invalid price data received');

            // 4. Persistence
            await this.db.run(
                'INSERT INTO gold_prices (timestamp, price) VALUES (?, ?)',
                [now, price]
            );

            this.cachedData = { timestamp: now, price };
            console.log(`[Success] Price updated: $${price}`);

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
    if (!data) return res.status(503).json({ error: 'Data initializing...' });
    res.json(data);
});

const start = async () => {
    await goldService.initialize();

    // Run once on startup to check if we missed a window
    await goldService.safeFetch();

    // Schedule: Run every even minute
    cron.schedule('*/2 * * * *', () => {
        goldService.safeFetch();
    });

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`[Server] Middle-API online at http://localhost:${PORT}`);
    });
};

start().catch(err => console.error('[Fatal] Startup failed:', err));
