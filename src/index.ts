import app from './app';
import http from 'http';
import { config } from './config';
import { goldService } from './services/gold.service';
import { attachRealtimeWs } from './ws/server';

async function bootstrap(): Promise<void> {
    // Warm up in-memory cache from DB before accepting traffic
    await goldService.warmUpCache();

    const server = http.createServer(app);
    attachRealtimeWs(server);

    server.listen(config.port, () => {
        console.log(`[Server] Listening on port ${config.port}`);
        console.log('[Server] WS endpoint ready at /ws/realtime');
    });
}

bootstrap();
