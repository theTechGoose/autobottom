/** Secure daily "yesterday's errors" endpoint for the external canary monitor.
 *
 *  POST /canary/errors (Bearer CANARY_SECRET) → JSON of the pipeline errors from
 *  the previous US-Eastern day: per-error finding id + timestamp + a Deno
 *  observability logs link, plus a total count and the set of finding ids.
 *  Errors are persisted by the step dispatcher (main.ts) via trackError.
 *
 *  Dispatched directly from main.ts (same @Req-via-router.fetch workaround as
 *  kv-export); the Controller below is a no-op stub registration. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Post } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { Description } from "#danet/swagger-decorators";
import { getErrorsInWindow } from "@audit/domain/data/stats-repository/mod.ts";
import { defaultOrgId } from "@core/business/auth/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const TZ = "America/New_York";
const LOGS_SUFFIX = "&start=now%2Fy&end=now";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function requireCanarySecret(req: Request): Response | null {
  const secret = Deno.env.get("CANARY_SECRET");
  if (!secret) return json({ error: "CANARY_SECRET not configured" }, 500);
  const header = req.headers.get("Authorization") ?? "";
  if (!constantTimeEq(header, `Bearer ${secret}`)) return json({ error: "unauthorized" }, 401);
  return null;
}

// ── US-Eastern day window ────────────────────────────────────────────────────

/** Offset (ms) of `tz` from UTC at `instant`: (tz wall-clock read as UTC) − instant.
 *  Negative for the Americas (e.g. −4h EDT, −5h EST). */
function tzOffsetMs(instant: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = dtf.formatToParts(new Date(instant));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - instant;
}

/** UTC ms of ET midnight (00:00) for the given ET calendar date. Uses the offset
 *  at that instant; midnight avoids the 1–3 AM DST-transition ambiguity. */
function etMidnightUtcMs(y: number, mo: number, d: number): number {
  const naive = Date.UTC(y, mo - 1, d, 0, 0, 0);
  return naive - tzOffsetMs(naive, TZ);
}

/** ET calendar date (Y/M/D) of an instant. */
function etYmd(instant: number): { y: number; mo: number; d: number } {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(instant)).split("-").map(Number);
  return { y: p[0], mo: p[1], d: p[2] };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Resolve the [since, until) UTC-ms window for an ET day. Default = yesterday
 *  (ET); `dateStr` (YYYY-MM-DD) overrides to that ET day. */
export function etDayWindow(now: number, dateStr?: string): { since: number; until: number; date: string } {
  let y: number, mo: number, d: number;
  const m = (dateStr ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    y = Number(m[1]); mo = Number(m[2]); d = Number(m[3]);
  } else {
    // Start of today ET, step back 12h to land safely in yesterday, read its date.
    const t = etYmd(now);
    const todayStart = etMidnightUtcMs(t.y, t.mo, t.d);
    ({ y, mo, d } = etYmd(todayStart - 12 * 3600_000));
  }
  const since = etMidnightUtcMs(y, mo, d);
  const next = new Date(Date.UTC(y, mo - 1, d + 1));
  const until = etMidnightUtcMs(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
  return { since, until, date: `${y}-${pad(mo)}-${pad(d)}` };
}

// ── Logs URL ─────────────────────────────────────────────────────────────────

/** Deno observability logs base for this deployment, derived from the request
 *  host (`autobottom.thetechgoose.deno.net` → `…/thetechgoose/autobottom/…`),
 *  falling back to CANARY_LOGS_BASE env or a hardcoded prod default. */
export function logsBaseFromReq(req: Request): string {
  try {
    const host = new URL(req.url).hostname;
    const m = host.match(/^([^.]+)\.([^.]+)\.deno\.net$/);
    if (m) return `https://console.deno.com/${m[2]}/${m[1]}/observability/logs?query=`;
  } catch { /* fall through */ }
  return Deno.env.get("CANARY_LOGS_BASE") ?? "https://console.deno.com/thetechgoose/autobottom/observability/logs?query=";
}

export function buildLogsUrl(base: string, findingId: string): string {
  return `${base}${encodeURIComponent(findingId)}${LOGS_SUFFIX}`;
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function handleCanaryErrors(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const authErr = requireCanarySecret(req);
  if (authErr) return authErr;

  const dateOverride = new URL(req.url).searchParams.get("date") ?? undefined;
  const { since, until, date } = etDayWindow(Date.now(), dateOverride);

  const rows = await getErrorsInWindow(defaultOrgId() as OrgId, since, until);

  // Dedup to unique timestamps (per requirement); keep first per ts.
  const seen = new Set<number>();
  const unique = rows.filter((r) => (seen.has(r.ts) ? false : (seen.add(r.ts), true)));

  const base = logsBaseFromReq(req);
  const findingIds = [...new Set(unique.map((r) => r.findingId).filter(Boolean))];

  console.log(`🐤 [CANARY] errors for ${date} (ET) — ${unique.length} unique of ${rows.length} rows, ${findingIds.length} findings`);

  return json({
    ok: true,
    timezone: TZ,
    date,
    window: { since, until },
    totalErrors: unique.length,
    findingIds,
    errors: unique.map((r) => ({
      findingId: r.findingId,
      step: r.step,
      error: r.error,
      ts: r.ts,
      timestamp: new Date(r.ts).toISOString(),
      logsUrl: buildLogsUrl(base, r.findingId),
    })),
  });
}

const STUB_NOTE = "canary endpoints are dispatched directly from main.ts; this controller is a no-op stub registration";

@SwaggerDescription("Canary — daily previous-day error report (handled in main.ts dispatch)")
@Controller("canary")
export class CanaryErrorsController {
  @Post("errors") @Description("see handleCanaryErrors in main.ts dispatch")
  canaryErrors() { return { ok: false, note: STUB_NOTE }; }
}
