import { registerGoldJob } from './gold.job';

// Register all cron jobs here. Add new jobs by importing and calling their register function.
export function registerAllJobs(): void {
    registerGoldJob();
    // registerSilverJob();
    // registerCleanupJob();
}
