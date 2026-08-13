/** Cron job registrations with OTel instrumentation. */
import { withSpan, metric, flushOtel } from "@core/data/datadog-otel/mod.ts";
import { runWatchdog } from "@cron/domain/business/watchdog/mod.ts";
import { runEmailReportsTick } from "@reporting/domain/business/email-reports-tick/mod.ts";
import { runWeeklySheetsExport, isWeeklySheetsFireTime, SHEET_JOB_NAMES } from "@cron/domain/business/weekly-sheets/mod.ts";
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

  // Weekly sheets export — posts the just-completed Mon–Sun week to the
  // configured Google Sheet (org = CHARGEBACKS_ORG_ID), on two days:
  //
  //   Mondays  9:00 AM ET — Wire Deductions
  //   Tuesdays 9:00 AM ET — Chargebacks + Omissions
  //
  // That split is the original monolith schedule. It was lost when the Apr 14
  // legacy sweep deleted main.ts, and the Jun 16 restore folded all three tabs
  // into one Tuesday job; restored 2026-08-13. Both jobs read the SAME Mon–Sun
  // window, so the per-week claim key includes the job name — otherwise Monday
  // would claim the week and Tuesday would silently skip. Re-run a missed or
  // failed week ad-hoc with the dashboard "Post to Sheet" button.
  //
  // One hourly tick drives both: the day-of-week cron field is not reliable
  // here (`0 13 * * 1` fired on SUNDAYS in prod for five straight weeks), and a
  // fixed UTC hour would drift at DST. isWeeklySheetsFireTime owns the schedule.
  Deno.cron("weekly-sheets", "0 * * * *", async () => {
    const due = SHEET_JOB_NAMES.filter((job) => isWeeklySheetsFireTime(job));
    if (!due.length) return;
    await withSpan("cron.weekly-sheets", async (span) => {
      for (const job of due) {
        try {
          const result = await runWeeklySheetsExport(job);
          span.setAttribute(`cron.${job}.appended`, result.appended ?? 0);
          span.setAttribute(`cron.${job}.skipped`, String(!!result.skipped));
          if (result.error) span.setAttribute(`cron.${job}.error`, result.error);
          metric("autobottom.cron.weekly_sheets", 1, { job, appended: String(result.appended ?? 0) });
        } catch (err) {
          console.error(`❌ [CRON:weekly-sheets] ${job} threw:`, err);
        }
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

  console.log("⏰ Cron jobs registered: watchdog (hourly), email-reports (every minute), weekly-sheets (hourly tick — wire Mondays, chargebacks+omissions Tuesdays, 9:00 AM America/New_York)");
}
