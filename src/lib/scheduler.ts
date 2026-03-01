import cron from "node-cron";

export interface SchedulerTaskHandlers {
  ingest: () => Promise<void>;
  analyze: () => Promise<void>;
  track: () => Promise<void>;
}

export function startScheduler(handlers: SchedulerTaskHandlers): ReturnType<typeof cron.schedule> {
  return cron.schedule("*/15 * * * *", async () => {
    await handlers.ingest();
    await handlers.analyze();
    await handlers.track();
  });
}
