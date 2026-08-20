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
import DateRangePicker from "../../islands/DateRangePicker.tsx";
import {
  renderQueueResults, renderCompletedResults, renderMemberButtons, queueFacets,
  filterAndSortQueue, filterCompleted, readQueueFilterParams,
  type QueueItem,
} from "../api/manager/queue.tsx";

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
  // ONE read feeds both sides of the split — /manager/api/queue returns pending
  // AND remediated items, so putting Completed next to the queue costs no extra
  // Firestore reads (frontend/CLAUDE.md: never add per-request hydration to an
  // auto-loading dashboard path).
  let allItems: QueueItem[] = [];
  try {
    const { items } = await apiFetch<{ items: QueueItem[] }>(`/manager/api/queue${asQs}`, ctx.req);
    allItems = items ?? [];
  } catch (e) {
    console.error("Manager queue load error:", e);
  }
  const pending = allItems.filter((i) => i.status !== "remediated");
  // Facets come from the OPEN items only: the question dropdown is a triage
  // tool, and offering a question with no open work left would filter the queue
  // side down to nothing.
  const facets = queueFacets(pending);
  const rows = filterAndSortQueue(pending, params);
  const completedRows = filterCompleted(allItems, params);

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
        <form
          id="queue-filters"
          style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:12px;"
          hx-get="/api/manager/queue"
          hx-target="#manager-queue-table"
          hx-swap="innerHTML"
          hx-trigger="change, keyup changed delay:350ms, submit"
        >
          {/* Window control — the same DateRangePicker every audit-listing view
              uses (presets + one two-month calendar for both ends). It writes
              epoch-ms into the hidden inputs below, which are what the form
              actually submits. */}
          <div class="form-group" style="margin-bottom:0;">
            <label>Window</label>
            <DateRangePicker
              since={params.since ?? 0}
              until={params.until ?? Date.now()}
              sinceInputId="q-since"
              untilInputId="q-until"
              pageInputId=""
              formId="queue-filters"
              targetId="manager-queue-table"
              endpoint="/api/manager/queue"
            />
          </div>
          <input type="hidden" name="since" id="q-since" value={String(params.since)} />
          <input type="hidden" name="until" id="q-until" value={String(params.until)} />
          {/* Team member is chosen from the button row below the filter bar,
              not typed. This hidden input is still what carries the choice
              into the form submission — the buttons write into it. */}
          <input type="hidden" name="member" id="q-member" value={params.member} />
          {/* Asks the queue fragment to also return the refreshed button row
              out-of-band. Only this page has that row — /operations posts to
              the same endpoint and must not get the OOB block. */}
          <input type="hidden" name="members" value="1" />
          {/* Asks the queue fragment for the compact tables AND the Completed
              side as an out-of-band swap, so one filter change refreshes both
              panes. Only this page is split — /operations posts to the same
              endpoint from a form with the same id and must not get it. */}
          <input type="hidden" name="split" value="1" />
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

        {/* Keep the page URL in sync with the filter state after every table
            refresh (form filter changes AND the window-preset buttons both swap
            #manager-queue-table). replaceState — not push — so the queue stays a
            single history entry whose URL tracks the latest filters. This is what
            makes Back from a remediation detail page restore the exact view
            (filters / date window / sort) instead of resetting to the default
            window: the page's SSR reads these same params back out. */}
        {/* One button per team member with open items, busiest first. Sits
            outside #manager-queue-table so it never filters itself down to the
            selected person; the queue fragment keeps it current via an
            out-of-band swap on this id. */}
        <div id="queue-member-buttons">
          {renderMemberButtons(pending, params)}
        </div>

        {/* Side-by-side: open work on the left, what you already closed out on
            the right, sharing one filter bar. Before this they were two separate
            pages, so submitting a remediation dropped you back on a queue with
            the row simply gone — and with several audits for the same team
            member you could not tell which one you had just handled. Now the row
            leaves the left pane and appears at the top of the right one.

            Only the left pane is the hx-target; the right rides along as an
            out-of-band swap from the same fragment response (`split=1`), so one
            request refreshes both and they can never disagree. */}
        <div class="rem-split">
          <section class="rem-split-pane">
            <div class="tbl-title" style="margin-bottom:10px;">Remediation Queue</div>
            <div
              id="manager-queue-table"
              {...{ "hx-on::after-swap": "history.replaceState(null,'','/manager?'+new URLSearchParams(new FormData(document.getElementById('queue-filters'))).toString())" }}
            >
              {renderQueueResults(rows, { compact: true })}
            </div>
          </section>

          <section class="rem-split-pane">
            <div class="tbl-title" style="margin-bottom:10px;">Completed</div>
            <div id="manager-completed-table">
              {renderCompletedResults(completedRows, params)}
            </div>
          </section>
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
            {/* Stamped by the Remediate button at click time, not rendered
                here: filter changes only replaceState the URL, so a value
                baked in at SSR would send the manager back to whatever view
                the page happened to load with. /operations has its own static
                returnTo and no element with this id, so the button's `if (rt)`
                guard leaves it alone. */}
            <input type="hidden" id="rem-returnTo" name="returnTo" value="" />
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
