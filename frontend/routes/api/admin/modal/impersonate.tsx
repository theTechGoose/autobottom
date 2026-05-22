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

    // Show info if email is provided as query param (selected via HTMX)
    const url = new URL(ctx.req.url);
    const selectedEmail = url.searchParams.get("selected");
    const selectedUser = selectedEmail ? users.find(u => u.email === selectedEmail) : null;
    // Destination from query param (set by the second select via HTMX) — if
    // missing, fall back to the role's home page so the operator gets a
    // sensible default the moment they pick a user.
    const destFromQuery = url.searchParams.get("dest") ?? "";
    const destination = destFromQuery
      || (selectedUser ? (ROLE_DESTINATIONS[selectedUser.role] ?? "/agent") : "");

    const html = renderToString(
      <div>
        <div class="modal-sub">Navigate to that user's portal as if you are them. All API calls will use their identity.</div>
        <form id="imp-form" style="margin-bottom:16px;">
          <div class="sf" style="margin-bottom:12px;">
            <label class="sf-label" style="margin-bottom:6px;display:block;">Select User</label>
            <select
              class="sf-input"
              id="imp-user-select"
              style="width:100%;font-size:13px;"
              hx-get="/api/admin/modal/impersonate"
              hx-target="#impersonate-modal-content"
              hx-swap="innerHTML"
              hx-include="closest form"
              name="selected"
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
                hx-get="/api/admin/modal/impersonate"
                hx-target="#impersonate-modal-content"
                hx-swap="innerHTML"
                hx-include="closest form"
                name="dest"
                hx-trigger="change"
              >
                {DESTINATION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} selected={opt.value === destination}>
                    {opt.label} ({opt.value})
                  </option>
                ))}
              </select>
            </div>
          )}
        </form>
        {selectedUser && (
          <div style="padding:10px 12px;border-radius:8px;background:var(--bg);border:1px solid var(--border);margin-bottom:16px;font-size:12px;color:var(--text-dim);">
            <span class={`pill pill-${ROLE_COLORS[selectedUser.role] ?? "blue"}`} style="margin-right:8px;">{selectedUser.role}</span>
            <span>→ {destination}</span>
          </div>
        )}
        <div class="modal-actions" style="margin-top:0;">
          <button class="sf-btn secondary" data-close-modal="impersonate-modal">Cancel</button>
          {selectedUser
            ? <a
                href={`${destination || "/agent"}?as=${encodeURIComponent(selectedUser.email)}`}
                class="sf-btn primary"
                style="text-decoration:none;"
                target="_blank"
                rel="noopener"
              >Go →</a>
            : <button class="sf-btn primary" disabled>Go →</button>
          }
        </div>
      </div>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
