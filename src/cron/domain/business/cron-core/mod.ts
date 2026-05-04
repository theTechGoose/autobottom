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
    // Log EVERY fire (even if no work to do) so we can confirm the
    // cron scheduler is actually firing on Deno Deploy. Past attempts
    // logged nothing when running.length===0 and we couldn't tell if
    // cron was silent because there was no work, or because it never ran.
    console.log(`⏰ [CRON:migration-tick] FIRED at ${new Date().toISOString()}`);
    try {
      const all = await listJobs();
      const running = all.filter((j) => j.status === "running");
      console.log(`⏰ [CRON:migration-tick] found ${all.length} total jobs, ${running.length} running`);
      if (running.length === 0) return;
      for (const job of running) {
        console.log(`⏰ [CRON:migration-tick] ticking ${job.jobId} (phase=${job.phase})`);
        await tickJob(job.jobId);
      }
      console.log(`⏰ [CRON:migration-tick] done`);
    } catch (err) {
      console.log(`❌ [CRON:migration-tick] ERROR: ${String(err).slice(0, 300)}`);
    }
  });

  console.log("⏰ Cron jobs registered: watchdog (hourly), migration-tick (every 1m)");
}
