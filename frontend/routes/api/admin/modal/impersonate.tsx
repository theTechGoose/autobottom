/** Modal content: Impersonate a user — dropdown populated from backend. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

const ROLE_COLORS: Record<string, string> = { admin: "blue", judge: "purple", manager: "yellow", reviewer: "green", user: "cyan" };
const ROLE_DESTINATIONS: Record<string, string> = { admin: "/admin/dashboard", judge: "/judge/dashboard", reviewer: "/review/dashboard", manager: "/manager", user: "/agent" };

export const handler = define.handlers({
  async GET(ctx) {
    let users: { email: string; role: string }[] = [];
    try { const d = await apiFetch<{ users: typeof users }>("/admin/users", ctx.req); users = d.users ?? []; } catch {}

    // Show info if email is provided as query param (selected via HTMX)
    const selectedEmail = new URL(ctx.req.url).searchParams.get("selected");
    const selectedUser = selectedEmail ? users.find(u => u.email === selectedEmail) : null;

    const html = renderToString(
      <div>
        <div class="modal-sub">Navigate to that user's portal as if you are them. All API calls will use their identity.</div>
        <div class="sf" style="margin-bottom:16px;">
          <label class="sf-label" style="margin-bottom:6px;display:block;">Select User</label>
          <select
            class="sf-input"
            id="imp-user-select"
            style="width:100%;font-size:13px;"
            hx-get="/api/admin/modal/impersonate"
            hx-target="#impersonate-modal-content"
            hx-swap="innerHTML"
            hx-include="this"
            name="selected"
            hx-trigger="change"
          >
            <option value="">-- choose a user --</option>
            {users.map(u => (
              <option key={u.email} value={u.email} selected={u.email === selectedEmail}>{u.email}</option>
            ))}
          </select>
        </div>
        {selectedUser && (
          <div style="padding:10px 12px;border-radius:8px;background:var(--bg);border:1px solid var(--border);margin-bottom:16px;font-size:12px;color:var(--text-dim);">
            <span class={`pill pill-${ROLE_COLORS[selectedUser.role] ?? "blue"}`} style="margin-right:8px;">{selectedUser.role}</span>
            <span>→ {ROLE_DESTINATIONS[selectedUser.role] ?? "/agent"}</span>
          </div>
        )}
        <div class="modal-actions" style="margin-top:0;">
          <button class="sf-btn secondary" data-close-modal="impersonate-modal">Cancel</button>
          {selectedUser
            ? <a href={`${ROLE_DESTINATIONS[selectedUser.role] ?? "/agent"}?as=${encodeURIComponent(selectedUser.email)}`} class="sf-btn primary" style="text-decoration:none;">Go →</a>
            : <button class="sf-btn primary" disabled>Go →</button>
          }
        </div>
      </div>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
