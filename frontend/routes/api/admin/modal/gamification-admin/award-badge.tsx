/** Award Badge — fragment POST handler. Reads the form, calls
 *  /admin/gamification/award-badge, renders a status pill into
 *  #award-badge-result. */

import { define } from "../../../../../lib/define.ts";
import { apiFetch } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface Resp {
  ok?: boolean;
  error?: string;
  email?: string;
  badgeId?: string;
  badgeName?: string;
  alreadyEarned?: boolean;
  xpAwarded?: number;
  newTotalXp?: number;
  newLevel?: number;
  leveledUp?: boolean;
}

function err(msg: string): Response {
  const html = renderToString(
    <div style="font-size:11px;padding:10px;border:1px solid var(--red);border-radius:6px;color:var(--red);">{msg}</div>,
  );
  return new Response(html, { headers: { "content-type": "text/html" } });
}

export const handler = define.handlers({
  async POST(ctx) {
    const fd = await ctx.req.formData();
    const email = String(fd.get("email") ?? "").trim();
    const badgeId = String(fd.get("badgeId") ?? "").trim();
    const broadcast = String(fd.get("broadcast") ?? "") === "1";

    if (!email) return err("Select a user.");
    if (!badgeId) return err("Select a badge.");

    let r: Resp;
    try {
      r = await apiFetch<Resp>("/admin/gamification/award-badge", ctx.req, {
        method: "POST",
        body: JSON.stringify({ email, badgeId, broadcast }),
        headers: { "content-type": "application/json" },
      });
    } catch (e) {
      return err(`Backend call failed: ${String((e as Error).message ?? e)}`);
    }
    if (!r.ok) return err(`Backend rejected: ${r.error ?? "unknown"}`);

    if (r.alreadyEarned) {
      const html = renderToString(
        <div style="font-size:11px;padding:10px;border:1px solid var(--yellow);border-radius:6px;color:var(--yellow);">
          ⚠ {r.email} has already earned this badge — no-op.
        </div>,
      );
      return new Response(html, { headers: { "content-type": "text/html" } });
    }

    const html = renderToString(
      <div style="border:1px solid var(--border);border-radius:6px;padding:12px;background:var(--bg);">
        <div style={`font-size:12px;font-weight:700;margin-bottom:8px;color:${r.leveledUp ? "var(--purple)" : "var(--green)"};`}>
          {r.leveledUp ? "✓ Awarded + Level Up" : "✓ Awarded"}
        </div>
        <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 14px;font-size:11px;">
          <span style="color:var(--text-dim);">User:</span><span style="font-family:var(--mono);">{r.email}</span>
          <span style="color:var(--text-dim);">Badge:</span><span>{r.badgeName} <span style="color:var(--text-dim);">({r.badgeId})</span></span>
          <span style="color:var(--text-dim);">XP awarded:</span><span style="font-family:var(--mono);">+{(r.xpAwarded ?? 0).toLocaleString()} XP</span>
          <span style="color:var(--text-dim);">New total XP:</span><span style="font-family:var(--mono);">{(r.newTotalXp ?? 0).toLocaleString()}</span>
          <span style="color:var(--text-dim);">New level:</span><span style="font-family:var(--mono);">L{r.newLevel ?? 0}{r.leveledUp ? " ↑" : ""}</span>
          {broadcast && (
            <>
              <span style="color:var(--text-dim);">Broadcast:</span><span style="color:var(--purple);">badge_earned{r.leveledUp ? " + level_up" : ""} toast emitted</span>
            </>
          )}
        </div>
      </div>,
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
