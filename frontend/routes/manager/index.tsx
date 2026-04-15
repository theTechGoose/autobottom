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

      <div class="stat-grid">
        <StatCard label="Total" value={stats.total} color="blue" />
        <StatCard label="Pending" value={stats.pending} color="yellow" />
        <StatCard label="Remediated" value={stats.remediated} color="green" />
        <StatCard label="Agents" value={agents.length} color="purple" />
      </div>

      {/* Queue table */}
      <div class="tbl">
        <div class="tbl-title">Remediation Queue</div>
        <table class="data-table">
          <thead><tr><th>Finding</th><th>Agent</th><th>Score</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>
            {queue.length === 0 ? (
              <tr class="empty-row"><td colSpan={5}>No items in queue</td></tr>
            ) : queue.map((item) => (
              <tr key={item.findingId}>
                <td class="mono">{item.findingId?.slice(0, 8)}</td>
                <td>{item.agentEmail ?? "\u2014"}</td>
                <td>{item.score != null ? <span class={`pill pill-${item.score >= 90 ? "green" : item.score >= 70 ? "yellow" : "red"}`}>{item.score}%</span> : "\u2014"}</td>
                <td><span class={`pill pill-${item.status === "remediated" ? "green" : "yellow"}`}>{item.status ?? "pending"}</span></td>
                <td>
                  <button
                    class="btn btn-ghost btn-sm"
                    onClick={() => { document.getElementById('remediate-modal')?.classList.add('open'); (document.getElementById('rem-findingId') as HTMLInputElement).value = item.findingId; }}
                  >Remediate</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
    </Layout>
  );
});
