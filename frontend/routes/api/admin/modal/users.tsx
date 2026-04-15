/** Modal content: Users — list + add + delete. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

export const handler = define.handlers({
  async GET(ctx) {
    let users: { email: string; role: string; supervisor?: string }[] = [];
    try { const d = await apiFetch<{ users: typeof users }>("/admin/users", ctx.req); users = d.users ?? []; } catch {}
    const roleColors: Record<string, string> = { admin: "blue", judge: "purple", manager: "yellow", reviewer: "green", user: "cyan" };
    const html = renderToString(
      <div>
        <div style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:11px;color:var(--text-dim);">{users.length} users</span>
        </div>
        <table class="data-table">
          <thead><tr><th>Email</th><th>Role</th><th>Supervisor</th><th>Action</th></tr></thead>
          <tbody>
            {users.length === 0 ? <tr class="empty-row"><td colSpan={4}>No users</td></tr> : users.map((u) => (
              <tr key={u.email}>
                <td style="font-weight:600;color:var(--text-bright);">{u.email}</td>
                <td><span class={`pill pill-${roleColors[u.role] ?? "blue"}`}>{u.role}</span></td>
                <td class="mono">{u.supervisor ?? "\u2014"}</td>
                <td><button class="btn btn-danger" style="padding:3px 8px;font-size:10px;" hx-post="/api/admin/users/delete" hx-vals={JSON.stringify({ email: u.email })} hx-confirm={`Delete ${u.email}?`} hx-swap="none">Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:16px;">
          <div style="font-size:13px;font-weight:700;color:var(--text-bright);margin-bottom:10px;">Add User</div>
          <form hx-post="/api/admin/users" hx-target="#users-modal-content" hx-trigger="submit" hx-swap="innerHTML">
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <input type="email" name="email" placeholder="Email" required style="flex:1;min-width:180px;" class="sf-input" />
              <input type="password" name="password" placeholder="Password" required style="width:120px;" class="sf-input" />
              <select name="role" class="sf-input" style="width:100px;"><option value="reviewer">Reviewer</option><option value="judge">Judge</option><option value="manager">Manager</option><option value="admin">Admin</option><option value="user">Agent</option></select>
              <button type="submit" class="btn btn-primary" style="padding:6px 14px;font-size:12px;">Add</button>
            </div>
          </form>
        </div>
      </div>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
