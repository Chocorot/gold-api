import { IncomingMessage } from 'http';
import { WebSocketServer } from 'ws';
import type { Server } from 'http';
import { TdRelay } from './td-relay';

const WS_PATH = '/ws/realtime';

export function attachRealtimeWs(server: Server): TdRelay {
    const relay = new TdRelay();
    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request: IncomingMessage, socket, head) => {
        const url = request.url || '';
        if (!url.startsWith(WS_PATH)) {
            socket.destroy();
            return;
        }

        wss.handleUpgrade(request, socket, head, (client) => {
            wss.emit('connection', client, request);
        });
    });

    wss.on('connection', (client) => {
        relay.addClient(client);
    });

    server.on('close', () => {
        relay.shutdown();
        wss.close();
    });

    return relay;
}
