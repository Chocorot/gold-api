# gold-api

A lightweight middleware API that fetches live gold (XAU/USD) prices from [Twelve Data](https://twelvedata.com/) and serves them via Express. Prices are persisted in Firestore and cached in memory. An external scheduler calls a private endpoint every 2 minutes to trigger the fetch.

## Features

- Private fetch endpoint triggered by an external scheduler every 2 minutes
- Built-in 1.9-minute guard prevents duplicate fetches from scheduler jitter
- Persists all prices to Firestore
- In-memory cache for zero-latency reads on the public endpoint
- Cache is warmed from Firestore on startup

## Requirements

- Node.js 18+
- A [Twelve Data](https://twelvedata.com/) API key
- A Firebase project with a Firestore database
- `GOOGLE_APPLICATION_CREDENTIALS` set to your Firebase service account key file

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment**

   Create a `.env` file in the project root:

   ```env
   TWELVE_DATA_KEY=your_twelve_data_api_key
   INTERNAL_API_KEY=your_secret_scheduler_key
   FIRESTORE_DATABASE=gold-api          # optional, defaults to "gold-api"
   PORT=3000                            # optional, defaults to 3000
   ```

## Usage

**Development** (runs with `ts-node`, no build step needed):

```bash
npm run dev
```

**Production** (compile first, then run):

```bash
npm run build
npm start
```

## API

### `GET /api/gold` — Public

Returns the latest cached gold price.

**Response `200`**
```json
{
  "timestamp": 1741651200000,
  "price": 3150.42
}
```

| Field | Type | Description |
|---|---|---|
| `timestamp` | `number` | Unix timestamp (ms) of when the price was recorded |
| `price` | `number` | XAU/USD price in USD |

Returns `503` if the cache is empty (first boot, no data yet).

---

### `POST /api/internal/gold/fetch` — Private

Triggers a gold price fetch from Twelve Data and stores the result in Firestore. Intended to be called by an external scheduler every 2 minutes.

**Required header**
```
x-api-key: your_secret_scheduler_key
```

**Response**
- `200` — fetch was executed (or skipped because last record is newer than 1.9 minutes)
- `401` — missing or incorrect `x-api-key`

No response body.

---

## How It Works

1. On startup, the most recent Firestore record is loaded into the in-memory cache.
2. Your external scheduler calls `POST /api/internal/gold/fetch` every 2 minutes with the `x-api-key` header.
3. The service checks whether the last stored price is older than 1.9 minutes. If not, the fetch is skipped silently.
4. If enough time has passed, it calls Twelve Data, writes the new price to Firestore, and updates the cache.
5. `GET /api/gold` reads directly from the in-memory cache for minimal latency.

## Project Structure

```
src/
  index.ts                    ← bootstrap: warm cache, start server
  app.ts                      ← Express setup & middleware
  config/
    index.ts                  ← all env vars in one place
  db/
    firestore.ts              ← Firestore client singleton
  types/
    gold.types.ts             ← shared TypeScript interfaces
  services/
    gold.service.ts           ← business logic: fetch, guard, store, cache
  middleware/
    privateAuth.ts            ← x-api-key auth guard
  routes/
    index.ts                  ← public route registry
    gold.routes.ts            ← GET /api/gold
    internal/
      index.ts                ← private route registry (applies auth)
      gold.routes.ts          ← POST /api/internal/gold/fetch
```

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **Web framework**: Express
- **HTTP client**: Axios
- **Database**: Firestore (via `firebase-admin`)
- **Config**: dotenv
