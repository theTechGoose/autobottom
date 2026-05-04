/** Cron job registrations with OTel instrumentation. */
import { withSpan, metric, flushOtel } from "@core/data/datadog-otel/mod.ts";
import { runWatchdog } from "@cron/domain/business/watchdog/mod.ts";
import { listJobs, tickJob } from "@admin/domain/business/migration/mod.ts";

export function registerCrons(): void {
  Deno.cron("watchdog", "0 * * * *", async () => {
    await withSpan("cron.watchdog", async (span) => {
      const { recovered } = await runWatchdog();
      span.setAttribute("cron.recovered", recovered);
      metric("autobottom.cron.watchdog", 1, { recovered: String(recovered) });
    }, {}, "internal");
    await flushOtel();
  });

  // Server-side driver for migration jobs. Each /status HTTP poll also ticks,
  // but operators close their tabs and walk away — we cannot rely on browser
  // polling. This cron guarantees forward progress regardless.
  //
  // Tick once per fire, not 4×. tickJob has a 30s wall-clock budget, so
  // 4× = up to 120s per fire, which exceeds the 60s cron interval and
  // backs fires up — Deno Deploy then occasionally skips or delays a fire
  // long enough to trip the stale watchdog. 1× = ≤30s, fits comfortably.
  Deno.cron("migration-tick", "* * * * *", async () => {
    const all = await listJobs();
    const running = all.filter((j) => j.status === "running");
    if (running.length === 0) return;
    console.log(`⏰ [CRON:migration-tick] ticking ${running.length} running job(s)`);
    for (const job of running) {
      await tickJob(job.jobId);
    }
  });

  console.log("⏰ Cron jobs registered: watchdog (hourly), migration-tick (every 1m)");
}
