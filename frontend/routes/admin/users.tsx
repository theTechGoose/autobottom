/** User management — list, add, delete users. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";

interface UserRecord { email: string; role: string; supervisor?: string; createdAt?: number; }

export default define.page(async function AdminUsers(ctx) {
  const user = ctx.state.user!;

  let users: UserRecord[] = [];
  try {
    const data = await apiFetch<{ users: UserRecord[] }>("/admin/users", ctx.req);
    users = data.users ?? [];
  } catch (e) {
    console.error("Failed to load users:", e);
  }

  const roleColors: Record<string, string> = { admin: "blue", judge: "purple", manager: "yellow", reviewer: "green", user: "cyan" };

  return (
    <Layout title="Users" section="admin" user={user}>
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;">
        <div>
          <h1>User Management</h1>
          <p class="page-sub">{users.length} users</p>
        </div>
        <button class="btn btn-primary" onclick="document.getElementById('add-modal').classList.add('open')">Add User</button>
      </div>

      <div id="user-list">
        <div class="tbl">
          <table class="data-table">
            <thead><tr><th>Email</th><th>Role</th><th>Supervisor</th><th>Action</th></tr></thead>
            <tbody>
              {users.length === 0 ? (
                <tr class="empty-row"><td colSpan={4}>No users</td></tr>
              ) : users.map((u) => (
                <tr key={u.email}>
                  <td style="font-weight:600;color:var(--text-bright);">{u.email}</td>
                  <td><span class={`pill pill-${roleColors[u.role] ?? "blue"}`}>{u.role}</span></td>
                  <td class="mono">{u.supervisor ?? "\u2014"}</td>
                  <td>
                    <button
                      class="btn btn-danger"
                      style="padding:3px 10px;font-size:10px;"
                      hx-post="/api/admin/users/delete"
                      hx-vals={JSON.stringify({ email: u.email })}
                      hx-confirm={`Delete ${u.email}?`}
                      hx-swap="none"
                    >Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add user modal */}
      <div id="add-modal" class="modal-overlay" onclick="if(event.target===this)this.classList.remove('open')">
        <div class="modal">
          <div class="modal-title">Add User</div>
          <div class="modal-sub">Create a new user account</div>
          <form hx-post="/api/admin/users/add" hx-target="#add-result" hx-swap="innerHTML">
            <div class="form-group">
              <label>Email</label>
              <input type="email" name="email" required placeholder="user@example.com" />
            </div>
            <div class="form-group">
              <label>Password</label>
              <input type="password" name="password" required placeholder="Min 6 characters" minlength={6} />
            </div>
            <div class="form-group">
              <label>Role</label>
              <select name="role" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text-bright);padding:10px 14px;font-size:14px;">
                <option value="reviewer">Reviewer</option>
                <option value="judge">Judge</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
                <option value="user">Agent</option>
              </select>
            </div>
            <div class="form-group">
              <label>Supervisor Email (optional)</label>
              <input type="email" name="supervisor" placeholder="manager@example.com" />
            </div>
            <div id="add-result" class="auth-error"></div>
            <div class="modal-actions">
              <button type="button" class="btn btn-ghost" onclick="document.getElementById('add-modal').classList.remove('open')">Cancel</button>
              <button type="submit" class="btn btn-primary">Create User</button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
});
