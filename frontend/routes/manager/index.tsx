/** Manager portal — queue, finding detail, agent management. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { StatCard } from "../../components/StatCard.tsx";
import { apiFetch } from "../../lib/api.ts";

interface QueueItem { findingId: string; agentEmail?: string; score?: number; failRatio?: string; status?: string; ts?: number; }
interface Agent { email: string; role: string; supervisor?: string; }

export default define.page(async function ManagerPage(ctx) {
  const user = ctx.state.user!;

  let stats = { total: 0, pending: 0, remediated: 0 };
  let queue: QueueItem[] = [];
  let agents: Agent[] = [];
  try {
    const [s, q, a] = await Promise.all([
      apiFetch<typeof stats>("/manager/api/stats", ctx.req),
      apiFetch<{ items: QueueItem[] }>("/manager/api/queue", ctx.req),
      apiFetch<{ agents: Agent[] }>("/manager/api/agents", ctx.req),
    ]);
    stats = s; queue = q.items ?? []; agents = a.agents ?? [];
  } catch (e) { console.error("Manager data error:", e); }

  return (
    <Layout title="Manager" section="manager" user={user}>
      <div class="page-header"><h1>Manager Portal</h1><p class="page-sub">Remediation queue and team management</p></div>

      <div id="manager-stats" hx-get="/api/manager/stats" hx-trigger="every 10s" hx-swap="innerHTML">
        <div class="stat-grid">
          <StatCard label="Total" value={stats.total} color="blue" />
          <StatCard label="Pending" value={stats.pending} color="yellow" />
          <StatCard label="Remediated" value={stats.remediated} color="green" />
          <StatCard label="Agents" value={agents.length} color="purple" />
        </div>
      </div>

      <div class="tbl">
        <div class="tbl-title" style="display:flex;align-items:center;justify-content:space-between;">
          <span>Remediation Queue</span>
          <span style="display:flex;gap:8px;align-items:center;">
            <span id="backfill-status" style="font-size:11px;color:var(--text-muted);"></span>
            <button
              class="btn btn-ghost btn-sm"
              hx-post="/api/manager/backfill"
              hx-target="#manager-queue"
              hx-swap="innerHTML"
              hx-indicator="#backfill-status"
            >Backfill Queue</button>
            <button
              class="btn btn-ghost btn-sm"
              {...{ "hx-on:click": "document.getElementById('notif-settings-modal').classList.add('open')" }}
            >Notification Settings</button>
          </span>
        </div>
        <div id="manager-queue" hx-get="/api/manager/queue" hx-trigger="every 10s" hx-swap="innerHTML">
          <table class="data-table">
            <thead><tr><th>Finding</th><th>Agent</th><th>Score</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {queue.length === 0 ? (
                <tr class="empty-row"><td colSpan={5}>No items in queue</td></tr>
              ) : queue.map((item) => (
                <tr
                  key={item.findingId}
                  style="cursor:pointer;"
                  hx-get={`/api/manager/finding?findingId=${item.findingId}`}
                  hx-target="#finding-detail-content"
                  hx-swap="innerHTML"
                  hx-trigger="click"
                  {...{ "hx-on:click": "document.getElementById('finding-detail-modal').classList.add('open')" }}
                >
                  <td class="mono">{item.findingId?.slice(0, 8)}</td>
                  <td>{item.agentEmail ?? "\u2014"}</td>
                  <td>{item.score != null ? <span class={`pill pill-${item.score >= 90 ? "green" : item.score >= 70 ? "yellow" : "red"}`}>{item.score}%</span> : "\u2014"}</td>
                  <td><span class={`pill pill-${item.status === "remediated" ? "green" : "yellow"}`}>{item.status ?? "pending"}</span></td>
                  <td>
                    <button
                      class="btn btn-ghost btn-sm"
                      {...{ "hx-on:click": `event.stopPropagation();document.getElementById('remediate-modal').classList.add('open');document.getElementById('rem-findingId').value='${item.findingId}'` }}
                    >Remediate</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Agent list */}
      <div class="tbl">
        <div class="tbl-title" style="display:flex;align-items:center;justify-content:space-between;">
          <span>Team Agents ({agents.length})</span>
          <button class="btn btn-primary btn-sm" onClick={() => document.getElementById('add-agent-modal')?.classList.add('open')}>Add Agent</button>
        </div>
        <table class="data-table">
          <thead><tr><th>Email</th><th>Role</th><th>Supervisor</th><th>Action</th></tr></thead>
          <tbody>
            {agents.length === 0 ? (
              <tr class="empty-row"><td colSpan={4}>No agents</td></tr>
            ) : agents.map((a) => (
              <tr key={a.email}>
                <td style="font-weight:600;color:var(--text-bright);">{a.email}</td>
                <td><span class="pill pill-cyan">{a.role}</span></td>
                <td class="mono">{a.supervisor ?? "\u2014"}</td>
                <td>
                  <button class="btn btn-danger btn-sm" hx-post="/api/manager/delete-agent" hx-vals={JSON.stringify({ email: a.email })} hx-confirm={`Delete ${a.email}?`} hx-swap="none">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Remediate modal */}
      <div id="remediate-modal" class="modal-overlay" onClick={(e: Event) => { if (e.target === e.currentTarget) (e.currentTarget as HTMLElement).classList.remove('open'); }}>
        <div class="modal">
          <div class="modal-title">Submit Remediation</div>
          <div class="modal-sub">Document what was discussed with the team member</div>
          <form hx-post="/api/manager/remediate" hx-target="#rem-result" hx-swap="innerHTML">
            <input type="hidden" name="findingId" id="rem-findingId" />
            <input type="hidden" name="username" value={user.email} />
            <div class="form-group">
              <label>Notes</label>
              <textarea name="notes" required placeholder="Describe the coaching conversation..." style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text-bright);padding:10px 14px;font-size:14px;min-height:120px;resize:vertical;"></textarea>
            </div>
            <div id="rem-result" class="auth-error"></div>
            <div class="modal-actions">
              <button type="button" class="btn btn-ghost" onClick={() => document.getElementById('remediate-modal')?.classList.remove('open')}>Cancel</button>
              <button type="submit" class="btn btn-primary">Submit</button>
            </div>
          </form>
        </div>
      </div>

      {/* Add agent modal */}
      <div id="add-agent-modal" class="modal-overlay" onClick={(e: Event) => { if (e.target === e.currentTarget) (e.currentTarget as HTMLElement).classList.remove('open'); }}>
        <div class="modal">
          <div class="modal-title">Add Agent</div>
          <form hx-post="/api/manager/add-agent" hx-target="#agent-result" hx-swap="innerHTML">
            <div class="form-group">
              <label>Email</label>
              <input type="email" name="email" required placeholder="agent@example.com" />
            </div>
            <div class="form-group">
              <label>Password</label>
              <input type="password" name="password" required placeholder="Min 6 characters" minlength={6} />
            </div>
            <input type="hidden" name="supervisor" value={user.email} />
            <div id="agent-result" class="auth-error"></div>
            <div class="modal-actions">
              <button type="button" class="btn btn-ghost" onClick={() => document.getElementById('add-agent-modal')?.classList.remove('open')}>Cancel</button>
              <button type="submit" class="btn btn-primary">Create Agent</button>
            </div>
          </form>
        </div>
      </div>

      {/* Finding detail modal */}
      <div
        id="finding-detail-modal"
        class="modal-overlay"
        {...{ "hx-on:click": "if(event.target===event.currentTarget)event.currentTarget.classList.remove('open')" }}
      >
        <div class="modal" style="max-width:900px;max-height:85vh;overflow-y:auto;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <div>
              <div class="modal-title">Finding Detail</div>
              <div class="modal-sub">Full audit context</div>
            </div>
            <button
              {...{ "hx-on:click": "document.getElementById('finding-detail-modal').classList.remove('open')" }}
              style="background:none;border:none;color:var(--text-dim);font-size:20px;cursor:pointer;padding:0 4px;line-height:1;"
            >&times;</button>
          </div>
          <div id="finding-detail-content"><div style="color:var(--text-dim);font-size:12px;padding:20px;text-align:center;">Click a row to load detail</div></div>
        </div>
      </div>

      {/* Notification settings modal — prefab subscriptions */}
      <div
        id="notif-settings-modal"
        class="modal-overlay"
        {...{ "hx-on:click": "if(event.target===event.currentTarget)event.currentTarget.classList.remove('open')" }}
      >
        <div class="modal" style="max-width:560px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <div>
              <div class="modal-title">Notification Settings</div>
              <div class="modal-sub">Subscribe to events for this team</div>
            </div>
            <button
              {...{ "hx-on:click": "document.getElementById('notif-settings-modal').classList.remove('open')" }}
              style="background:none;border:none;color:var(--text-dim);font-size:20px;cursor:pointer;padding:0 4px;line-height:1;"
            >&times;</button>
          </div>
          <div id="notif-settings-content" hx-get="/api/manager/notif-settings" hx-trigger="load delay:50ms" hx-swap="innerHTML">
            <div style="color:var(--text-dim);font-size:12px;padding:20px;text-align:center;">Loading...</div>
          </div>
        </div>
      </div>
    </Layout>
  );
});
