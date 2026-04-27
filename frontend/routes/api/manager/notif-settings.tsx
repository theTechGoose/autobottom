/** HTMX fragment — prefab subscription settings (GET renders form, POST saves). */
import { define } from "../../../lib/define.ts";
import { apiFetch, apiPost, parseHtmxBody } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface PrefabEvent { type: string; label: string; icon: string; description: string; }

const PREFAB_EVENTS: PrefabEvent[] = [
  { type: "sale_completed", label: "Sale Completed", icon: "\u{1F4B0}", description: "Fires when an agent completes an audit" },
  { type: "perfect_score", label: "Perfect Score", icon: "\u{1F4AF}", description: "Fires when an agent scores 100% on an audit" },
  { type: "ten_audits_day", label: "10 Audits in a Day", icon: "\u{1F525}", description: "Fires when an agent completes 10 audits in a single day" },
  { type: "level_up", label: "Level Up", icon: "\u{2B06}", description: "Fires when any user levels up" },
  { type: "badge_earned", label: "Badge Earned", icon: "\u{1F3C5}", description: "Fires when any user earns a new badge" },
  { type: "streak_milestone", label: "Streak Milestone", icon: "\u{1F525}", description: "Fires when a user hits a 7, 14, or 30 day streak" },
  { type: "queue_cleared", label: "Queue Cleared", icon: "\u{1F5E1}", description: "Fires when the manager queue reaches zero" },
  { type: "weekly_accuracy_100", label: "Weekly 100% Accuracy", icon: "\u{1F3AF}", description: "Fires when an agent has 100% accuracy for the week" },
];

function renderForm(subs: Record<string, boolean>, statusMsg?: string): string {
  return renderToString(
    <form hx-post="/api/manager/notif-settings" hx-target="#notif-settings-content" hx-swap="innerHTML" style="padding:8px 0;">
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;">
        {PREFAB_EVENTS.map((ev) => (
          <label key={ev.type} style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;cursor:pointer;">
            <input type="checkbox" name={ev.type} value="1" checked={subs[ev.type] === true} />
            <span style="font-size:16px;">{ev.icon}</span>
            <span style="flex:1;">
              <div style="font-weight:600;color:var(--text-bright);">{ev.label}</div>
              <div style="font-size:11px;color:var(--text-muted);">{ev.description}</div>
            </span>
          </label>
        ))}
      </div>
      {statusMsg && <div style="font-size:11px;color:var(--green);margin-bottom:8px;">{statusMsg}</div>}
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>,
  );
}

export const handler = define.handlers({
  async GET(ctx) {
    try {
      const subs = await apiFetch<Record<string, boolean>>("/manager/api/prefab-subscriptions", ctx.req);
      return new Response(renderForm(subs ?? {}), { headers: { "content-type": "text/html" } });
    } catch {
      return new Response(`<div class="error-text">Failed to load subscriptions</div>`, { headers: { "content-type": "text/html" } });
    }
  },
  async POST(ctx) {
    try {
      const body = await parseHtmxBody(ctx.req);
      const subs: Record<string, boolean> = {};
      for (const ev of PREFAB_EVENTS) subs[ev.type] = body[ev.type] !== undefined;
      await apiPost("/manager/api/prefab-subscriptions", ctx.req, subs);
      return new Response(renderForm(subs, "Saved."), { headers: { "content-type": "text/html" } });
    } catch (e) {
      return new Response(`<div class="error-text">Save failed: ${e}</div>`, { headers: { "content-type": "text/html" } });
    }
  },
});
