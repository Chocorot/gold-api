import app from './app';
import { config } from './config';
import { goldService } from './services/gold.service';

async function bootstrap(): Promise<void> {
    // Warm up in-memory cache from DB before accepting traffic
    await goldService.warmUpCache();

    app.listen(config.port, () => {
        console.log(`[Server] Listening on port ${config.port}`);
    });
}

bootstrap();
