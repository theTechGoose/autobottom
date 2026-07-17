/** Manager Portal — the manager's home: queue of confirmed failures awaiting
 *  remediation, live stat cards, and the finding-detail / remediate modals.
 *
 *  Stats + queue load via HTMX from `/api/manager/stats` and
 *  `/api/manager/queue`. The two modal shells are rendered INLINE here (not
 *  via an HTMX swap) so the queue fragment's inline `classList.add('open')`
 *  has a real element to toggle and a real container to swap detail into —
 *  see frontend/CLAUDE.md Gotcha #1 (HTMX-injected markup never hydrates).
 *
 *  `?as=<email>` is threaded into the Audit-History link AND the queue/stats
 *  fragment URLs: the queue is team-scoped (manager's department+shift), so
 *  an admin impersonating a manager must see that manager's queue. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";
import {
  renderQueueResults, queueFacets, filterAndSortQueue, readQueueFilterParams, type QueueItem,
} from "../api/manager/queue.tsx";

/** Format a ms timestamp as the `YYYY-MM-DDTHH:MM` string a datetime-local
 *  input expects (browser-local; the filter itself always uses the absolute ms
 *  stored in the hidden input, so the picker's display tz is cosmetic). */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Inline click handler for a window preset: set the hidden since/until (ms) +
 *  the calendar display, then refetch just the table. n=0 → all time. */
function winHandler(n: number): string {
  const sExpr = n === 0 ? "0" : `u-${n}*86400000`;
  const sDisp = n === 0 ? "''" : "f(s)";
  return `(()=>{var u=Date.now(),s=${sExpr};` +
    `document.getElementById('q-since').value=s;document.getElementById('q-until').value=u;` +
    `var sd=document.getElementById('q-since-display'),ud=document.getElementById('q-until-display');` +
    `var p=function(x){return String(x).padStart(2,'0')},f=function(m){var d=new Date(m);return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes())};` +
    `if(sd)sd.value=${sDisp};if(ud)ud.value=f(u);` +
    `htmx.ajax('GET','/api/manager/queue',{source:'#queue-filters',target:'#manager-queue-table',swap:'innerHTML'});})()`;
}

export default define.page(async function ManagerPortalPage(ctx) {
  const user = ctx.state.user!;
  const url = new URL(ctx.req.url);
  const asEmail = url.searchParams.get("as") ?? "";
  const asQs = asEmail ? `?as=${encodeURIComponent(asEmail)}` : "";
  const auditsHref = `/manager/audits${asQs}`;

  // Load the queue once here (single read — same cost as the old lazy load) so
  // we can build the filter bar's autosuggest lists and server-render the first
  // (sorted) table. Filter changes re-fetch only the table via /api/manager/queue.
  const params = readQueueFilterParams(url.searchParams);
  let pending: QueueItem[] = [];
  try {
    const { items } = await apiFetch<{ items: QueueItem[] }>(`/manager/api/queue${asQs}`, ctx.req);
    pending = (items ?? []).filter((i) => i.status !== "remediated");
  } catch (e) {
    console.error("Manager queue load error:", e);
  }
  const facets = queueFacets(pending);
  const rows = filterAndSortQueue(pending, params);
  const sinceDisplay = params.since && params.since > 0 ? toLocalInput(params.since) : "";
  const untilDisplay = params.until ? toLocalInput(params.until) : "";

  return (
    <Layout title="Manager Portal" section="manager" user={user} gameState={ctx.state.gameState} pathname={url.pathname}>
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;gap:16px;">
        <div>
          <h1>Manager Portal</h1>
          <p class="page-sub">Confirmed failures awaiting remediation</p>
        </div>
        <a href={auditsHref} class="btn btn-ghost btn-sm">Audit History &rarr;</a>
      </div>

      {/* Stat strip — Total / Pending / Remediated / Agents, refreshed every 10s. */}
      <div id="manager-stats" hx-get={`/api/manager/stats${asQs}`} hx-trigger="load, every 10s" hx-swap="innerHTML" style="margin-bottom:18px;">
        <div class="stat-grid"><div class="placeholder-card">Loading stats…</div></div>
      </div>

      {/* Queue table — server-rendered here (sorted newest-first by default);
          the filter bar re-fetches ONLY the table via /api/manager/queue. All
          filtering/sorting is in-memory over the already-loaded list (no extra
          Firestore reads). The queue table does not auto-poll, so filter state
          isn't clobbered mid-use. */}
      <div class="card" style="padding:14px 18px;">
        <div class="tbl-title" style="margin-bottom:10px;">Remediation Queue</div>

        <form
          id="queue-filters"
          style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:12px;"
          hx-get="/api/manager/queue"
          hx-target="#manager-queue-table"
          hx-swap="innerHTML"
          hx-trigger="change, keyup changed delay:350ms, submit"
        >
          <div class="form-group" style="margin-bottom:0;">
            <label>Window</label>
            <div style="display:flex;gap:4px;flex-wrap:wrap;">
              {[7, 14, 30, 60, 90].map((n) => (
                <button key={n} type="button" class="btn btn-ghost btn-sm" {...{ "hx-on:click": winHandler(n) }}>{n}D</button>
              ))}
              <button type="button" class="btn btn-ghost btn-sm" {...{ "hx-on:click": winHandler(0) }}>All</button>
            </div>
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label>Since</label>
            <input type="datetime-local" id="q-since-display" value={sinceDisplay} {...{ "hx-on:change": "document.getElementById('q-since').value=(this.value?new Date(this.value).getTime():0)" }} />
            <input type="hidden" name="since" id="q-since" value={String(params.since)} />
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label>Until</label>
            <input type="datetime-local" id="q-until-display" value={untilDisplay} {...{ "hx-on:change": "document.getElementById('q-until').value=(this.value?new Date(this.value).getTime():Date.now())" }} />
            <input type="hidden" name="until" id="q-until" value={String(params.until)} />
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label>Team Member</label>
            <input type="text" name="member" list="queue-members" value={params.member} placeholder="Search name…" autocomplete="off" />
            <datalist id="queue-members">{facets.members.map((m) => <option key={m} value={m} />)}</datalist>
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label>Failed Question</label>
            <select name="q">
              <option value="">All questions</option>
              {facets.questions.map((q) => <option key={q} value={q} selected={q === params.q}>{q}</option>)}
            </select>
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label>Sale</label>
            <div style="display:flex;gap:12px;align-items:center;height:34px;">
              <label style="display:flex;gap:5px;align-items:center;font-size:12px;cursor:pointer;">
                <input type="checkbox" name="wgs" value="1" checked={params.wgs} /> WGS
              </label>
              <label style="display:flex;gap:5px;align-items:center;font-size:12px;cursor:pointer;">
                <input type="checkbox" name="mcc" value="1" checked={params.mcc} /> MCC
              </label>
            </div>
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label>Sort</label>
            <select name="sort">
              <option value="recent" selected={params.sort === "recent"}>Newest first</option>
              <option value="oldest" selected={params.sort === "oldest"}>Oldest first</option>
              <option value="failpct" selected={params.sort === "failpct"}>Highest % failed</option>
            </select>
          </div>
          {asEmail && <input type="hidden" name="as" value={asEmail} />}
          <a href={`/manager${asQs}`} class="btn btn-ghost btn-sm">Clear</a>
        </form>

        <div id="manager-queue-table">
          {renderQueueResults(rows)}
        </div>
      </div>

      {/* ===== Modal shells (plain HTML — NOT islands). The queue fragment
          toggles `.open` (CSS: .modal-overlay.open{display:flex}) and swaps
          detail into #finding-detail-content / sets #rem-findingId. ===== */}
      <div id="finding-detail-modal" class="modal-overlay">
        <div class="modal" style="width:min(720px,92vw);max-height:88vh;overflow-y:auto;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <div class="modal-title">Finding Detail</div>
            <button
              class="btn btn-ghost btn-sm"
              {...{ "hx-on:click": "this.closest('.modal-overlay').classList.remove('open')" }}
            >&times;</button>
          </div>
          <div id="finding-detail-content">
            <div class="placeholder-card">Select a finding…</div>
          </div>
        </div>
      </div>

      <div id="remediate-modal" class="modal-overlay">
        <div class="modal" style="width:min(520px,92vw);">
          <div class="modal-title">Remediate Failure</div>
          <div class="modal-sub" style="margin-bottom:14px;">Record how this failure was addressed with the agent.</div>
          <form hx-post="/api/manager/remediate" hx-swap="none">
            <input type="hidden" id="rem-findingId" name="findingId" value="" />
            {/* username → remediatedBy on the queue item + gamification credit */}
            <input type="hidden" name="username" value={user.email} />
            <div class="form-group">
              <label>Remediation notes</label>
              <textarea name="notes" rows={5} required placeholder="What was discussed / corrected with the agent…"></textarea>
            </div>
            <div class="modal-actions">
              <button
                type="button"
                class="btn btn-ghost"
                {...{ "hx-on:click": "this.closest('.modal-overlay').classList.remove('open')" }}
              >Cancel</button>
              <button type="submit" class="btn btn-primary">Submit</button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
});
