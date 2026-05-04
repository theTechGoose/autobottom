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
  // polling. This cron guarantees forward progress regardless. tickJob is
  // wall-clock-budgeted and idempotent; ticking 4× back-to-back gives ~30s of
  // work per fire so cadence approaches what active polling delivers.
  Deno.cron("migration-tick", "* * * * *", async () => {
    const all = await listJobs();
    const running = all.filter((j) => j.status === "running");
    if (running.length === 0) return;
    for (const job of running) {
      for (let i = 0; i < 4; i++) {
        const after = await tickJob(job.jobId);
        if (!after || after.status !== "running") break;
      }
    }
  });

  console.log("⏰ Cron jobs registered: watchdog (hourly), migration-tick (every 1m)");
}
