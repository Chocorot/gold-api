# gold-api

A lightweight middleware API that fetches live gold (XAU/USD) prices from [Twelve Data](https://twelvedata.com/) and serves them via a simple Express endpoint. Prices are persisted in a local SQLite database and cached in memory, with a cron job polling every 2 minutes.

## Features

- Polls Twelve Data for XAU/USD price every 2 minutes (on even minutes)
- Persists all prices to a local SQLite database (`gold_data.db`)
- In-memory caching with a 90-second guard to prevent redundant API calls
- Loads the most recent price from the database on startup
- Single REST endpoint to retrieve the latest price

## Requirements

- Node.js 18+
- A [Twelve Data](https://twelvedata.com/) API key

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment**

   Create a `.env` file in the project root:

   ```env
   TWELVE_DATA_KEY=your_api_key_here
   PORT=3000        # optional, defaults to 3000
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

### `GET /api/gold`

Returns the latest cached gold price.

**Response**

```json
{
  "timestamp": 1741651200000,
  "price": 3150.42
}
```

| Field | Type | Description |
|---|---|---|
| `timestamp` | `number` | Unix timestamp (ms) of when the price was fetched |
| `price` | `number` | XAU/USD price in USD |

Returns `503` with `{ "error": "Data initializing..." }` if no price has been fetched yet.

## How It Works

1. On startup, the last price is loaded from SQLite into memory.
2. A `node-cron` job fires every 2 minutes and calls Twelve Data only when the current minute is even and the cache is older than 90 seconds.
3. New prices are written to SQLite and the in-memory cache is updated.
4. `GET /api/gold` reads directly from the in-memory cache for minimal latency.

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **Web framework**: Express
- **HTTP client**: Axios
- **Database**: SQLite (via `sqlite` + `sqlite3`)
- **Scheduler**: node-cron
- **Config**: dotenv
