# gold-api

A middleware API for XAU/USD data built with Express + TypeScript.
It stores real-time price points and historical OHLC candles in Firestore, then serves them via public endpoints for charting.

## Architecture

### Firestore Collections

| Collection | Interval | Used For |
|---|---|---|
| `gold_prices` | 2-minute realtime | Latest price endpoint |
| `gold_ohlc_daily` | `1day` | 1M, 3M, 6M, YTD charts |
| `gold_ohlc_weekly` | `1week` | 1Y, 2Y charts |
| `gold_ohlc_monthly` | `1month` | 5Y, 10Y charts |

Why split by interval:
- Twelve Data intraday depth is limited.
- Daily, weekly, and monthly series are better for long-range chart windows.

### Range Mapping

| Query `range` | Collection |
|---|---|
| `1m` | `gold_ohlc_daily` |
| `3m` | `gold_ohlc_daily` |
| `6m` | `gold_ohlc_daily` |
| `ytd` | `gold_ohlc_daily` |
| `1y` | `gold_ohlc_weekly` |
| `2y` | `gold_ohlc_weekly` |
| `5y` | `gold_ohlc_monthly` |
| `10y` | `gold_ohlc_monthly` |

## Requirements

- Node.js 18+
- Twelve Data API key
- Firebase project with Firestore
- `GOOGLE_APPLICATION_CREDENTIALS` pointing to a service-account JSON file

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` in project root:

```env
TWELVE_DATA_KEY=your_twelve_data_api_key
INTERNAL_API_KEY=your_private_scheduler_key
FIRESTORE_DATABASE=gold-api
PORT=3000
```

## Run

Development:

```bash
npm run dev
```

Production:

```bash
npm run build
npm start
```

## API

### Public Endpoints

#### `GET /api/gold`
Returns latest cached realtime price.

Response `200`:

```json
{
  "timestamp": 1741651200000,
  "price": 3150.42
}
```

Response `503` when service has no cached price yet.

#### `GET /api/gold/history?range=1m`
Returns OHLC candles sorted oldest to newest.

Allowed `range` values:
- `1m`, `3m`, `6m`, `ytd`, `1y`, `2y`, `5y`, `10y`

Response `200` example:

```json
[
  { "date": "2026-02-12", "open": 3050.1, "high": 3080.5, "low": 3040.0, "close": 3070.2 },
  { "date": "2026-02-13", "open": 3071.0, "high": 3095.0, "low": 3060.0, "close": 3088.5 }
]
```

### Private Endpoints

All endpoints below require header:

```text
x-api-key: your_private_scheduler_key
```

Returns `401` if the key is missing or invalid.

#### `POST /api/internal/gold/fetch`
Realtime fetch endpoint for 2-minute scheduler.

#### `POST /api/internal/gold/fetch-daily`
Fetches missing daily candles (smart incremental).

#### `POST /api/internal/gold/fetch-weekly`
Fetches missing weekly candles (smart incremental).

#### `POST /api/internal/gold/fetch-monthly`
Fetches missing monthly candles (smart incremental).

#### `POST /api/internal/gold/backfill`
Backfills older history in 5000-candle chunks.

Request body:

```json
{ "interval": "daily" }
```

`interval` must be one of: `daily`, `weekly`, `monthly`.

Response example:

```json
{ "done": false, "stored": 5000, "oldestDate": "2012-03-14" }
```

When no more historical candles are returned:

```json
{ "done": true, "stored": 0, "oldestDate": "1969-12-31" }
```

## Scheduler Cron Examples (UTC)

Cron format:

```text
minute hour day-of-month month day-of-week
```

| Frequency | Cron | Endpoint |
|---|---|---|
| Every 2 minutes | `*/2 * * * *` | `POST /api/internal/gold/fetch` |
| Daily at 23:59 UTC | `59 23 * * *` | `POST /api/internal/gold/fetch-daily` |
| Weekly Monday 00:01 UTC | `1 0 * * 1` | `POST /api/internal/gold/fetch-weekly` |
| Monthly day 1 at 00:01 UTC | `1 0 1 * *` | `POST /api/internal/gold/fetch-monthly` |

## Backfill Suggestion

Run each backfill endpoint repeatedly until `done: true`:
- Daily interval: likely multiple calls for deep history
- Weekly interval: usually one call is enough
- Monthly interval: usually one call is enough

## Project Structure

```text
src/
  index.ts
  app.ts
  config/
    index.ts
  db/
    firestore.ts
  middleware/
    privateAuth.ts
  routes/
    index.ts
    gold.routes.ts
    internal/
      index.ts
      gold.routes.ts
  services/
    gold.service.ts
    gold.history.service.ts
  types/
    gold.types.ts
```

## Tech Stack

- Node.js
- TypeScript
- Express
- Axios
- Firebase Admin SDK (Firestore)
- dotenv
