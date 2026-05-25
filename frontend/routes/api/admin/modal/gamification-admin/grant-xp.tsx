/** Grant XP — fragment POST handler. Reads the form, calls
 *  /admin/gamification/grant-xp, renders a status pill into
 *  #grant-xp-result. */

import { define } from "../../../../../lib/define.ts";
import { apiFetch } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface Resp {
  ok?: boolean;
  error?: string;
  email?: string;
  amount?: number;
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
    const amountRaw = String(fd.get("amount") ?? "").trim();
    const amount = parseInt(amountRaw, 10);
    const broadcast = String(fd.get("broadcast") ?? "") === "1";
    const reason = String(fd.get("reason") ?? "").trim() || undefined;

    if (!email) return err("Select a user.");
    if (!Number.isFinite(amount) || amount < 1 || amount > 5000) {
      return err("Amount must be an integer between 1 and 5000.");
    }

    let r: Resp;
    try {
      r = await apiFetch<Resp>("/admin/gamification/grant-xp", ctx.req, {
        method: "POST",
        body: JSON.stringify({ email, amount, broadcast, reason }),
        headers: { "content-type": "application/json" },
      });
    } catch (e) {
      return err(`Backend call failed: ${String((e as Error).message ?? e)}`);
    }
    if (!r.ok) return err(`Backend rejected: ${r.error ?? "unknown"}`);

    const html = renderToString(
      <div style="border:1px solid var(--border);border-radius:6px;padding:12px;background:var(--bg);">
        <div style={`font-size:12px;font-weight:700;margin-bottom:8px;color:${r.leveledUp ? "var(--purple)" : "var(--green)"};`}>
          {r.leveledUp ? "✓ Granted + Level Up" : "✓ Granted"}
        </div>
        <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 14px;font-size:11px;">
          <span style="color:var(--text-dim);">User:</span><span style="font-family:var(--mono);">{r.email}</span>
          <span style="color:var(--text-dim);">Amount:</span><span style="font-family:var(--mono);">+{(r.amount ?? 0).toLocaleString()} XP</span>
          <span style="color:var(--text-dim);">New total XP:</span><span style="font-family:var(--mono);">{(r.newTotalXp ?? 0).toLocaleString()}</span>
          <span style="color:var(--text-dim);">New level:</span><span style="font-family:var(--mono);">L{r.newLevel ?? 0}{r.leveledUp ? " ↑" : ""}</span>
          {broadcast && r.leveledUp && (
            <>
              <span style="color:var(--text-dim);">Broadcast:</span><span style="color:var(--purple);">level_up toast emitted</span>
            </>
          )}
        </div>
      </div>,
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
