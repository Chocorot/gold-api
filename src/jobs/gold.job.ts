import cron from 'node-cron';
import { goldService } from '../services/gold.service';

export function registerGoldJob(): void {
    // Run at every even minute (*/2 * * * *)
    cron.schedule('* * * * *', () => goldService.fetchAndStore());
    console.log('[Job] Gold price job registered (every 2 min)');
}
