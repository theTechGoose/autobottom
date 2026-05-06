/** Modal content: Users — 3 tabs (Members / Add / Manager Scopes) matching production. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { Icon } from "../../../../components/Icons.tsx";

const ROLE_COLORS: Record<string, string> = { admin: "blue", judge: "purple", manager: "yellow", reviewer: "green", user: "cyan" };
const ROLE_BG: Record<string, string> = { admin: "var(--blue-bg)", judge: "var(--purple-bg)", manager: "var(--yellow-bg)", reviewer: "var(--green-bg)", user: "var(--cyan-bg)" };
const ROLE_FG: Record<string, string> = { admin: "var(--blue)", judge: "var(--purple)", manager: "var(--yellow)", reviewer: "var(--green)", user: "var(--cyan)" };

const ROLES = [
  { role: "admin", name: "Admin", desc: "Full access. Manages judges & managers.", icon: Icon.users, bg: "var(--blue-bg)", fg: "var(--blue)" },
  { role: "judge", name: "Judge", desc: "Reviews appeals. Owns reviewers.", icon: Icon.scale, bg: "var(--purple-bg)", fg: "var(--purple)" },
  { role: "manager", name: "Manager", desc: "Remediates failures. Scoped by dept+shift.", icon: Icon.clipboardList, bg: "var(--yellow-bg)", fg: "var(--yellow)" },
  { role: "reviewer", name: "Reviewer", desc: "Verifies audit findings.", icon: Icon.playCircle, bg: "var(--green-bg)", fg: "var(--green)" },
  { role: "user", name: "Team Member", desc: "Call center team member.", icon: Icon.barChart, bg: "var(--cyan-bg)", fg: "var(--cyan)" },
];

export async function renderUsersModal(
  req: Request,
  opts: { tab?: string; addRole?: string } = {},
): Promise<Response> {
  const tab = opts.tab ?? "list";
  const addRole = opts.addRole ?? "";

  let users: { email: string; role: string; supervisor?: string }[] = [];
  try { const d = await apiFetch<{ users: typeof users }>("/admin/users", req); users = d.users ?? []; } catch {}

  const managers = users.filter(u => u.role === "manager");
  const judges = users.filter(u => u.role === "judge");
  const supervisors = [...judges, ...users.filter(u => u.role === "admin")];

    const html = renderToString(
      <div style="display:flex;flex-direction:column;height:100%;">
        {/* Header + Tabs */}
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;flex-shrink:0;padding:0 0 8px;">
          <div class="modal-title" style="margin-bottom:0;">Team</div>
          <div style="display:flex;gap:4px;">
            <button class={`sf-btn ghost um-tab ${tab === "list" ? "active" : ""}`} hx-get="/api/admin/modal/users?tab=list" hx-target="#users-modal-content" hx-swap="innerHTML">Members</button>
            <button class={`sf-btn ghost um-tab ${tab === "add" ? "active" : ""}`} hx-get="/api/admin/modal/users?tab=add" hx-target="#users-modal-content" hx-swap="innerHTML">+ Add</button>
            <button class={`sf-btn ghost um-tab ${tab === "scopes" ? "active" : ""}`} hx-get="/api/admin/modal/users?tab=scopes" hx-target="#users-modal-content" hx-swap="innerHTML">Manager Scopes</button>
          </div>
        </div>
        <div class="modal-sub" style="flex-shrink:0;">Manage your organization's users, roles, and manager access scopes</div>

        {/* Members Tab */}
        {tab === "list" && (
          <div style="overflow-y:auto;flex:1;min-height:0;">
            <div style="max-height:400px;overflow-y:auto;margin-bottom:12px;">
              {users.length === 0 ? (
                <div style="color:var(--text-dim);font-size:11px;padding:20px;text-align:center;">No users</div>
              ) : users.map(u => (
                <div key={u.email} class="um-user-row">
                  <div class="um-user-avatar" style={`background:${ROLE_BG[u.role] ?? "var(--blue-bg)"};color:${ROLE_FG[u.role] ?? "var(--blue)"};`}>{u.email.slice(0, 2).toUpperCase()}</div>
                  <div class="um-user-info">
                    <div class="um-user-email">{u.email}</div>
                    <div class="um-user-meta">{u.supervisor ? `→ ${u.supervisor}` : ""}</div>
                  </div>
                  <span class={`pill pill-${ROLE_COLORS[u.role] ?? "blue"}`}>{u.role}</span>
                  <button class="sf-btn danger" style="font-size:9px;padding:3px 8px;" hx-post="/api/admin/modal/users/delete" hx-vals={JSON.stringify({ email: u.email })} hx-target="#users-modal-content" hx-swap="innerHTML" hx-confirm={`Delete ${u.email}?`}>Delete</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Add Tab */}
        {tab === "add" && !addRole && (
          <div style="overflow-y:auto;flex:1;min-height:0;">
            <div class="modal-group">
              <div class="modal-group-title">1. Choose Role</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
                {ROLES.map(r => (
                  <button
                    key={r.role}
                    class="um-role"
                    hx-get={`/api/admin/modal/users?tab=add&role=${r.role}`}
                    hx-target="#users-modal-content"
                    hx-swap="innerHTML"
                  >
                    <span class="um-role-icon" style={`background:${r.bg};color:${r.fg};`}>{r.icon(16)}</span>
                    <span class="um-role-info">
                      <span class="um-role-name">{r.name}</span>
                      <span class="um-role-desc">{r.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Add Tab — Step 2: Credentials */}
        {tab === "add" && addRole && (
          <div style="overflow-y:auto;flex:1;min-height:0;">
            <form hx-post="/api/admin/modal/users/create" hx-target="#users-modal-content" hx-swap="innerHTML">
              <input type="hidden" name="role" value={addRole} />

              {/* Supervisor for reviewer/manager */}
              {(addRole === "reviewer" || addRole === "manager") && (
                <div class="modal-group">
                  <div class="modal-group-title">2. Assign Supervisor</div>
                  <select class="sf-input" name="supervisor" style="width:100%;">
                    <option value="">-- Select --</option>
                    {supervisors.map(s => <option key={s.email} value={s.email}>{s.email} ({s.role})</option>)}
                  </select>
                </div>
              )}

              <div class="modal-group">
                <div class="modal-group-title">{(addRole === "reviewer" || addRole === "manager") ? "3" : "2"}. Credentials</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                  <div class="sf">
                    <label class="sf-label">Email</label>
                    <input type="text" class="sf-input" name="email" placeholder="jsmith@example.com" autocomplete="off" required />
                  </div>
                  <div class="sf">
                    <label class="sf-label">Password</label>
                    <input type="password" class="sf-input" name="password" placeholder="••••••••" required />
                  </div>
                </div>
              </div>

              <button class="sf-btn primary" type="submit" style="width:100%;padding:10px;font-size:12px;border-radius:8px;">
                Create {ROLES.find(r => r.role === addRole)?.name ?? addRole}
              </button>
            </form>
          </div>
        )}

        {/* Manager Scopes Tab */}
        {tab === "scopes" && (
          <div style="flex:1;min-height:0;overflow:hidden;">
            <div style="display:flex;gap:16px;height:380px;">
              {/* Manager list (left) */}
              <div style="width:220px;flex-shrink:0;border:1px solid var(--border);border-radius:8px;overflow-y:auto;">
                <div style="padding:8px 12px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--bg-raised);z-index:1;">Managers</div>
                {managers.length === 0 ? (
                  <div style="padding:20px 12px;text-align:center;color:var(--text-dim);font-size:11px;">No managers</div>
                ) : managers.map(m => (
                  <div
                    key={m.email}
                    style="padding:8px 12px;cursor:pointer;font-size:11px;font-weight:600;color:var(--text-muted);border-bottom:1px solid var(--border);transition:all 0.1s;"
                    hx-get={`/api/admin/modal/users/scopes?email=${encodeURIComponent(m.email)}`}
                    hx-target="#um-scope-editor"
                    hx-swap="innerHTML"
                  >{m.email}</div>
                ))}
              </div>
              {/* Scope editor (right) */}
              <div style="flex:1;min-width:0;">
                <div id="um-scope-editor" style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:12px;">
                  Select a manager to configure their scope
                </div>
              </div>
            </div>
          </div>
        )}

        <div class="modal-actions" style="margin-top:12px;flex-shrink:0;">
          <button class="sf-btn secondary" data-close-modal="users-modal">Close</button>
        </div>
      </div>
    );
  return new Response(html, { headers: { "content-type": "text/html" } });
}

export const handler = define.handlers({
  GET(ctx) {
    const url = new URL(ctx.req.url);
    return renderUsersModal(ctx.req, {
      tab: url.searchParams.get("tab") ?? "list",
      addRole: url.searchParams.get("role") ?? "",
    });
  },
});
