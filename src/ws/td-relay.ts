import WebSocket from 'ws';
import { config } from '../config';

const TD_WS_URL = 'wss://ws.twelvedata.com/v1/quotes/price';
const DEFAULT_SYMBOL = 'XAU/USD';

interface ClientCommand {
    action?: string;
    symbol?: string;
}

interface PricePayload {
    type: 'price';
    symbol: string;
    price: number;
    timestamp: number;
    source: 'twelvedata-ws';
}

export class TdRelay {
    private readonly clients = new Set<WebSocket>();
    private readonly subscriptions = new Map<WebSocket, string>();

    private tdSocket: WebSocket | null = null;
    private tdReconnectTimer: NodeJS.Timeout | null = null;
    private tdShutdownTimer: NodeJS.Timeout | null = null;

    private isShuttingDown = false;

    addClient(client: WebSocket): void {
        this.clients.add(client);

        this.send(client, {
            type: 'hello',
            message: 'Send {"action":"subscribe","symbol":"XAU/USD"} to start stream',
        });

        client.on('message', (raw) => this.onClientMessage(client, raw.toString()));

        client.on('close', () => {
            this.subscriptions.delete(client);
            this.clients.delete(client);
            this.scheduleTdShutdown();
        });

        client.on('error', () => {
            this.subscriptions.delete(client);
            this.clients.delete(client);
            this.scheduleTdShutdown();
        });
    }

    shutdown(): void {
        this.isShuttingDown = true;

        if (this.tdReconnectTimer) {
            clearTimeout(this.tdReconnectTimer);
            this.tdReconnectTimer = null;
        }

        if (this.tdShutdownTimer) {
            clearTimeout(this.tdShutdownTimer);
            this.tdShutdownTimer = null;
        }

        if (this.tdSocket) {
            this.tdSocket.close();
            this.tdSocket = null;
        }

        for (const client of this.clients) {
            client.close();
        }

        this.clients.clear();
        this.subscriptions.clear();
    }

    private onClientMessage(client: WebSocket, raw: string): void {
        let msg: ClientCommand;
        try {
            msg = JSON.parse(raw) as ClientCommand;
        } catch {
            this.send(client, { type: 'error', message: 'Invalid JSON message' });
            return;
        }

        if (msg.action !== 'subscribe') {
            this.send(client, { type: 'error', message: 'Unsupported action. Use action="subscribe"' });
            return;
        }

        const symbol = (msg.symbol || DEFAULT_SYMBOL).trim().toUpperCase();
        if (symbol !== DEFAULT_SYMBOL) {
            this.send(client, { type: 'error', message: 'Only XAU/USD is supported right now' });
            return;
        }

        this.subscriptions.set(client, symbol);
        this.send(client, { type: 'subscribed', symbol });

        this.ensureTdConnected();
    }

    private ensureTdConnected(): void {
        if (!config.twelveDataKey) {
            this.broadcast({ type: 'error', message: 'Server missing TWELVE_DATA_KEY' });
            return;
        }

        if (this.tdShutdownTimer) {
            clearTimeout(this.tdShutdownTimer);
            this.tdShutdownTimer = null;
        }

        if (this.tdSocket && this.tdSocket.readyState === WebSocket.OPEN) {
            this.subscribeTd();
            return;
        }

        if (this.tdSocket && this.tdSocket.readyState === WebSocket.CONNECTING) {
            return;
        }

        const wsUrl = `${TD_WS_URL}?apikey=${encodeURIComponent(config.twelveDataKey)}`;
        this.tdSocket = new WebSocket(wsUrl);

        this.tdSocket.on('open', () => {
            console.log('[TDRelay] Connected to Twelve Data WS');
            this.subscribeTd();
        });

        this.tdSocket.on('message', (raw) => this.onTdMessage(raw.toString()));

        this.tdSocket.on('close', () => {
            console.log('[TDRelay] Twelve Data WS closed');
            this.tdSocket = null;

            if (this.isShuttingDown) return;
            if (this.subscriptions.size === 0) return;

            this.tdReconnectTimer = setTimeout(() => this.ensureTdConnected(), 3_000);
        });

        this.tdSocket.on('error', (err) => {
            console.error('[TDRelay] Twelve Data WS error:', err);
        });
    }

    private subscribeTd(): void {
        if (!this.tdSocket || this.tdSocket.readyState !== WebSocket.OPEN) return;

        const symbols = Array.from(new Set(this.subscriptions.values()));
        if (symbols.length === 0) return;

        this.tdSocket.send(JSON.stringify({
            action: 'subscribe',
            params: {
                symbols: symbols.join(','),
            },
        }));
    }

    private onTdMessage(raw: string): void {
        let msg: any;
        try {
            msg = JSON.parse(raw);
        } catch {
            return;
        }

        // Handle standard quote payloads and forward normalized price updates.
        const symbol = msg.symbol || msg.meta?.symbol;
        const rawPrice = msg.price ?? msg.close;
        if (!symbol || rawPrice == null) return;

        const price = Number(rawPrice);
        if (Number.isNaN(price)) return;

        const timestamp = Number(msg.timestamp) * 1000 || Date.now();
        const payload: PricePayload = {
            type: 'price',
            symbol,
            price,
            timestamp,
            source: 'twelvedata-ws',
        };

        this.broadcast(payload);
    }

    private scheduleTdShutdown(): void {
        if (this.subscriptions.size > 0) return;
        if (!this.tdSocket) return;

        if (this.tdShutdownTimer) clearTimeout(this.tdShutdownTimer);

        // Grace period avoids connect/disconnect thrashing during quick reconnects.
        this.tdShutdownTimer = setTimeout(() => {
            if (this.subscriptions.size > 0) return;
            if (!this.tdSocket) return;

            console.log('[TDRelay] No subscribers. Closing Twelve Data WS connection.');
            this.tdSocket.close();
            this.tdSocket = null;
        }, 20_000);
    }

    private send(client: WebSocket, payload: unknown): void {
        if (client.readyState !== WebSocket.OPEN) return;
        client.send(JSON.stringify(payload));
    }

    private broadcast(payload: unknown): void {
        for (const client of this.clients) {
            this.send(client, payload);
        }
    }
}
