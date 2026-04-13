import { Module } from "@danet/core";

export { runWatchdog, getStuckFindings } from "@cron/domain/business/watchdog/mod.ts";
export { prevWeekWindow } from "@cron/domain/business/weekly-sheets/mod.ts";

// Cron jobs are registered at bootstrap time, not via HTTP controllers.
// The actual Deno.cron calls will be wired in bootstrap/mod.ts once
// all business logic is fully ported.

@Module({
  controllers: [],
  injectables: [],
})
export class CronModule {}
