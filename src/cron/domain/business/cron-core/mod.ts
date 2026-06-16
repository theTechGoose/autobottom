/** Cron job registrations with OTel instrumentation. */
import { withSpan, metric, flushOtel } from "@core/data/datadog-otel/mod.ts";
import { runWatchdog } from "@cron/domain/business/watchdog/mod.ts";
import { runEmailReportsTick } from "@reporting/domain/business/email-reports-tick/mod.ts";
import { runWeeklySheetsExport } from "@cron/domain/business/weekly-sheets/mod.ts";
// Migration imports preserved for when migration-tick is re-enabled:
// import { listJobs, tickJob } from "@admin/domain/business/migration/mod.ts";
// import { runInBackgroundLane } from "@core/data/firestore/mod.ts";

export function registerCrons(): void {
  Deno.cron("watchdog", "0 * * * *", async () => {
    await withSpan("cron.watchdog", async (span) => {
      const { recovered } = await runWatchdog();
      span.setAttribute("cron.recovered", recovered);
      metric("autobottom.cron.watchdog", 1, { recovered: String(recovered) });
    }, {}, "internal");
    await flushOtel();
  });

  // Email Reports — every minute. Internally guarded by:
  //  • kill-switch flag (`system-flag:email-reports-enabled`) cached 60s
  //  • background lane (never competes with foreground requests)
  //  • atomic claim per (configId, minute) — multi-isolate safe
  //  • 90s timeout on prepareReport; sendEmail runs free to avoid mid-send
  //    double-send races
  // Migration-tick precedent (see commented block below) is exactly why each
  // of those rails exists.
  Deno.cron("email-reports", "* * * * *", async () => {
    await withSpan("cron.email-reports", async (span) => {
      try {
        const result = await runEmailReportsTick();
        span.setAttribute("cron.ran", result.ran);
        span.setAttribute("cron.skipped", result.skipped);
        span.setAttribute("cron.failed", result.failed);
        metric("autobottom.cron.email_reports", 1, {
          ran: String(result.ran),
          failed: String(result.failed),
        });
      } catch (err) {
        console.error("❌ [CRON:email-reports] tick threw:", err);
      }
    }, {}, "internal");
    await flushOtel();
  });

  // Weekly sheets export — Mondays 13:00 UTC. Posts the just-completed week's
  // chargebacks/omissions/wire to the configured Google Sheet (org =
  // CHARGEBACKS_ORG_ID). This was silently lost in the monolith→modular cutover,
  // which is why the sheet went stale. Idempotent per (org, week) via a claim
  // key so a re-fire can't double-append. Re-run a missed/failed week ad-hoc
  // with the dashboard "Post to Sheet" button.
  Deno.cron("weekly-sheets", "0 13 * * 1", async () => {
    await withSpan("cron.weekly-sheets", async (span) => {
      try {
        const result = await runWeeklySheetsExport();
        span.setAttribute("cron.appended", result.appended ?? 0);
        span.setAttribute("cron.skipped", String(!!result.skipped));
        if (result.error) span.setAttribute("cron.error", result.error);
        metric("autobottom.cron.weekly_sheets", 1, { appended: String(result.appended ?? 0) });
      } catch (err) {
        console.error("❌ [CRON:weekly-sheets] threw:", err);
      }
    }, {}, "internal");
    await flushOtel();
  });

  // migration-tick disabled. The KV → Firestore migration is complete.
  // The every-minute cron was the primary cause of periodic 60s connection-
  // pool wedges that timed out reviewer decide submissions, dashboard
  // polls, getFinding lookups, and login. Background-lane slot caps don't
  // protect the underlying HTTP/2 connection pool to firestore.googleapis.com,
  // so a tick's burst of chunked writes (up to 20 × ~1MB in parallel) was
  // saturating connections for ~10-30s every 60s. Foreground requests
  // started during that window queued at the network layer and hit our
  // 60s abort timer. Uncomment if you need to resume migration work.
  //
  // Deno.cron("migration-tick", "* * * * *", async () => {
  //   console.log(`⏰ [CRON:migration-tick] FIRED at ${new Date().toISOString()}`);
  //   try {
  //     const all = await listJobs();
  //     const running = all.filter((j) => j.status === "running");
  //     console.log(`⏰ [CRON:migration-tick] found ${all.length} total jobs, ${running.length} running`);
  //     if (running.length === 0) return;
  //     for (const job of running) {
  //       console.log(`⏰ [CRON:migration-tick] ticking ${job.jobId} (phase=${job.phase})`);
  //       await runInBackgroundLane(() => tickJob(job.jobId));
  //     }
  //     console.log(`⏰ [CRON:migration-tick] done`);
  //   } catch (err) {
  //     console.log(`❌ [CRON:migration-tick] ERROR: ${String(err).slice(0, 300)}`);
  //   }
  // });

  console.log("⏰ Cron jobs registered: watchdog (hourly), email-reports (every minute), weekly-sheets (Mondays 13:00 UTC)");
}
