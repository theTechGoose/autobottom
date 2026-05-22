/** Modal content: Impersonate a user — dropdown populated from backend. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

const ROLE_COLORS: Record<string, string> = { admin: "blue", judge: "purple", manager: "yellow", reviewer: "green", user: "cyan" };
const ROLE_DESTINATIONS: Record<string, string> = { admin: "/admin/dashboard", judge: "/judge/dashboard", reviewer: "/review/dashboard", manager: "/manager", user: "/agent" };

// Full menu of destinations the operator can land on. Includes the role
// home pages plus the actual work-queue pages (judge queue, review queue,
// agent dashboard, etc.) — useful for impersonating an admin into a
// specific sub-portal without typing the URL. NOT gated by target user's
// role; if the destination is inaccessible to them it just bounces off
// the relevant middleware, which is the same outcome as today's "type
// the URL by hand" workaround.
const DESTINATION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "/admin/dashboard", label: "Admin Dashboard" },
  { value: "/admin/audits", label: "Admin Audits" },
  { value: "/admin/users", label: "Admin Users" },
  { value: "/judge", label: "Judge Queue" },
  { value: "/judge/dashboard", label: "Judge Dashboard" },
  { value: "/review", label: "Review Queue" },
  { value: "/review/dashboard", label: "Review Dashboard" },
  { value: "/manager", label: "Manager" },
  { value: "/manager/audits", label: "Manager Audit History" },
  { value: "/agent", label: "Agent Dashboard" },
  { value: "/chat", label: "Chat" },
];

export const handler = define.handlers({
  async GET(ctx) {
    let users: { email: string; role: string }[] = [];
    try { const d = await apiFetch<{ users: typeof users }>("/admin/users", ctx.req); users = d.users ?? []; } catch {}

    const url = new URL(ctx.req.url);
    // User-select picker re-fetches the modal with ?email=<chosen> so the
    // destination dropdown can default to the user's role-home page.
    const selectedEmail = url.searchParams.get("email");
    const selectedUser = selectedEmail ? users.find(u => u.email === selectedEmail) : null;
    const defaultDest = selectedUser ? (ROLE_DESTINATIONS[selectedUser.role] ?? "/agent") : "";

    // The Go button is a plain form submit to a server-side redirect route
    // (frontend/routes/admin/impersonate-go.tsx) — this reads the live
    // form values at submit time instead of relying on an HTMX swap to
    // update an anchor's pre-baked href. Previous design lost the chosen
    // destination on race-y dropdown changes.
    const html = renderToString(
      <div>
        <div class="modal-sub">Navigate to that user's portal as if you are them. All API calls will use their identity.</div>
        <form
          method="get"
          action="/admin/impersonate-go"
          target="_blank"
          rel="noopener"
          style="margin-bottom:0;"
        >
          <div class="sf" style="margin-bottom:12px;">
            <label class="sf-label" style="margin-bottom:6px;display:block;">Select User</label>
            <select
              class="sf-input"
              id="imp-user-select"
              style="width:100%;font-size:13px;"
              hx-get="/api/admin/modal/impersonate"
              hx-target="#impersonate-modal-content"
              hx-swap="innerHTML"
              hx-include="this"
              name="email"
              hx-trigger="change"
            >
              <option value="">-- choose a user --</option>
              {users.map(u => (
                <option key={u.email} value={u.email} selected={u.email === selectedEmail}>{u.email} ({u.role})</option>
              ))}
            </select>
          </div>
          {selectedUser && (
            <div class="sf" style="margin-bottom:12px;">
              <label class="sf-label" style="margin-bottom:6px;display:block;">Open at</label>
              <select
                class="sf-input"
                style="width:100%;font-size:13px;"
                name="dest"
              >
                {DESTINATION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} selected={opt.value === defaultDest}>
                    {opt.label} ({opt.value})
                  </option>
                ))}
              </select>
            </div>
          )}
          {selectedUser && (
            <div style="padding:10px 12px;border-radius:8px;background:var(--bg);border:1px solid var(--border);margin-bottom:16px;font-size:12px;color:var(--text-dim);">
              <span class={`pill pill-${ROLE_COLORS[selectedUser.role] ?? "blue"}`} style="margin-right:8px;">{selectedUser.role}</span>
              <span>→ open the selected page as {selectedUser.email}</span>
            </div>
          )}
          <div class="modal-actions" style="margin-top:0;">
            <button type="button" class="sf-btn secondary" data-close-modal="impersonate-modal">Cancel</button>
            <button type="submit" class="sf-btn primary" disabled={!selectedUser}>Go →</button>
          </div>
        </form>
      </div>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
