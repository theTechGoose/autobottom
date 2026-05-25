/** Reset XP — fragment route. Reads the HTML form, calls the backend's
 *  /admin/reset-xp endpoint, and renders a report card. Dry-run and live
 *  paths share this handler; the live path enforces HX-Prompt="WIPE XP". */

import { define } from "../../../../../lib/define.ts";
import { apiFetch } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface ResetXpReport {
  mode: "full" | "window";
  dryRun: boolean;
  scannedUsers: number;
  affectedUsers: string[];
  earnedBadgesDeleted: number;
  gameStatesReset: number;
  badgeStatsReset: number;
  totalXpRemoved: number;
}

interface Resp { ok?: boolean; report?: ResetXpReport; error?: string }

function err(msg: string): Response {
  const html = renderToString(
    <div style="font-size:11px;padding:10px;border:1px solid var(--red);border-radius:6px;color:var(--red);">
      {msg}
    </div>,
  );
  return new Response(html, { headers: { "content-type": "text/html" } });
}

function ymdToMs(ymd: string, endOfDay = false): number | undefined {
  if (!ymd) return undefined;
  const t = Date.parse(`${ymd}T${endOfDay ? "23:59:59.999" : "00:00:00"}Z`);
  return Number.isFinite(t) ? t : undefined;
}

export const handler = define.handlers({
  async POST(ctx) {
    // FormData supports duplicate keys; parseHtmxBody collapses them, so
    // read role checkboxes manually via getAll.
    const fd = await ctx.req.formData();
    const roles = fd.getAll("role").map((v) => String(v)).filter(Boolean);
    if (!roles.length) return err("Select at least one role.");

    const fromMs = ymdToMs(String(fd.get("from") ?? ""));
    // Treat `to` as inclusive day → end-of-day timestamp.
    const toMs = ymdToMs(String(fd.get("to") ?? ""), true);
    if ((fromMs == null) !== (toMs == null)) {
      return err("Provide BOTH from and to, or leave both blank for a full reset.");
    }
    if (fromMs != null && toMs != null && fromMs >= toMs) {
      return err("`from` must be before `to`.");
    }

    const dryRunVal = String(fd.get("dryRun") ?? "1");
    const dryRun = dryRunVal === "1" || dryRunVal === "true";

    // Live wipe requires the typed-confirm header from hx-prompt.
    if (!dryRun) {
      const prompt = ctx.req.headers.get("HX-Prompt") ?? "";
      if (prompt.trim() !== "WIPE XP") {
        return err("Live wipe requires typing exactly `WIPE XP` to confirm.");
      }
    }

    let r: Resp;
    try {
      r = await apiFetch<Resp>("/admin/reset-xp", ctx.req, {
        method: "POST",
        body: JSON.stringify({ roles, fromMs, toMs, dryRun }),
        headers: { "content-type": "application/json" },
      });
    } catch (e) {
      return err(`Backend call failed: ${String((e as Error).message ?? e)}`);
    }

    if (!r.ok || !r.report) return err(`Backend rejected: ${r.error ?? "unknown"}`);

    const rep = r.report;
    const heading = rep.dryRun ? "DRY RUN — no writes performed" : "WIPE COMPLETE";
    const color = rep.dryRun ? "var(--yellow)" : "var(--green)";

    const html = renderToString(
      <div style="border:1px solid var(--border);border-radius:6px;padding:12px;background:var(--bg);">
        <div style={`font-size:12px;font-weight:700;margin-bottom:10px;color:${color};`}>
          {rep.dryRun ? "⚠" : "✓"} {heading}
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px 14px;font-size:11px;margin-bottom:10px;">
          <div><span style="color:var(--text-dim);">Mode:</span> <span style="font-family:var(--mono);">{rep.mode}</span></div>
          <div><span style="color:var(--text-dim);">Users scanned:</span> <span style="font-family:var(--mono);">{rep.scannedUsers}</span></div>
          <div><span style="color:var(--text-dim);">Users affected:</span> <span style="font-family:var(--mono);">{rep.affectedUsers.length}</span></div>
          <div><span style="color:var(--text-dim);">Earned-badges deleted:</span> <span style="font-family:var(--mono);">{rep.earnedBadgesDeleted}</span></div>
          <div><span style="color:var(--text-dim);">Game-states reset:</span> <span style="font-family:var(--mono);">{rep.gameStatesReset}</span></div>
          <div><span style="color:var(--text-dim);">Badge-stats reset:</span> <span style="font-family:var(--mono);">{rep.badgeStatsReset}</span></div>
          <div style="grid-column:span 2;"><span style="color:var(--text-dim);">Total XP removed:</span> <span style="font-family:var(--mono);font-weight:600;">{rep.totalXpRemoved.toLocaleString()}</span></div>
        </div>
        {rep.affectedUsers.length > 0 && (
          <details>
            <summary style="font-size:11px;color:var(--text-dim);cursor:pointer;">Show {rep.affectedUsers.length} affected user{rep.affectedUsers.length === 1 ? "" : "s"}</summary>
            <ul style="margin:6px 0 0 0;padding:0;list-style:none;max-height:240px;overflow:auto;font-family:var(--mono);font-size:10px;color:var(--text);">
              {rep.affectedUsers.map((e) => <li key={e} style="padding:2px 6px;">{e}</li>)}
            </ul>
          </details>
        )}
      </div>,
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
