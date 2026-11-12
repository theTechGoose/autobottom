/** VO Dashboard (REQ-034..041) — a VO login's queue of its department's failed
 *  audits, laid out like the Manager Portal: To Review on the left, Reviewed on
 *  the right, one filter bar (date window, team member, WGS / MCC — nothing
 *  else, and no Audit History).
 *
 *  An admin landing here with no `?as=` gets the "VO View" picker of every VO
 *  login (REQ-039); picking one re-opens this page as that login — the
 *  middleware's `?as=` swap — and `as` rides on every fragment URL.
 *
 *  The review modal is rendered inline, not swapped in, so the table's Review
 *  buttons have a real element to open (frontend/CLAUDE.md Gotcha #1). */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { StatCard } from "../../components/StatCard.tsx";
import { apiFetch } from "../../lib/api.ts";
import DateRangePicker from "../../islands/DateRangePicker.tsx";
import {
  filterVoPending, filterVoReviewed, readVoFilterParams, renderVoMemberButtons, renderVoQueueResults,
  renderVoReviewedResults, renderVoReviewModal, type VoQueueItem,
} from "../api/vo/queue.tsx";
import { renderByQuestionToggle, type QuestionOrders } from "../api/manager/queue.tsx";
import { splitVoQueue } from "@core/business/tm-review/mod.ts";

export default define.page(async function VoDashboard(ctx) {
  const user = ctx.state.user!;
  const url = new URL(ctx.req.url);

  if (user.role === "admin") {
    let logins: string[] = [];
    try {
      const { users } = await apiFetch<{ users: { email: string; role: string }[] }>("/admin/users", ctx.req);
      logins = (users ?? []).filter((u) => u.role === "vo").map((u) => u.email).sort();
    } catch (e) { console.error("VO View — user list failed:", e); }
    return (
      <Layout title="VO View" section="vo" user={user} gameState={ctx.state.gameState} pathname={url.pathname}>
        <div class="page-header"><h1>VO View</h1><p class="page-sub">Open any VO login's dashboard</p></div>
        <div class="card" style="padding:14px 18px;display:flex;flex-direction:column;gap:8px;">
          {logins.length === 0
            ? <div class="placeholder-card">No VO logins yet — add one under Users with the VO role.</div>
            : logins.map((email) => (
              <a key={email} class="sb-link vo-login" data-email={email} href={`/vo?as=${encodeURIComponent(email)}`}>{email}</a>
            ))}
        </div>
      </Layout>
    );
  }

  const asEmail = url.searchParams.get("as") ?? "";
  const asQs = asEmail ? `?as=${encodeURIComponent(asEmail)}` : "";
  let items: VoQueueItem[] = [];
  let questionOrders: QuestionOrders = {};
  try {
    const res = await apiFetch<{ items: VoQueueItem[]; questionOrders?: QuestionOrders }>(`/vo/api/queue${asQs}`, ctx.req);
    items = res.items ?? [];
    questionOrders = res.questionOrders ?? {};
  } catch (e) { console.error("VO queue load error:", e); }

  const params = readVoFilterParams(url.searchParams);
  const pendingRows = filterVoPending(items, params, questionOrders);
  const reviewedRows = filterVoReviewed(items, params);
  const { pending, reviewed } = splitVoQueue(items);
  const appealed = reviewed.filter((i) => i.appealState && !i.tmReview).length;

  return (
    <Layout title="VO Dashboard" section="vo" user={user} gameState={ctx.state.gameState} pathname={url.pathname}>
      <div class="page-header">
        <h1>VO Dashboard</h1>
        <p class="page-sub">Failed audits waiting for your review</p>
      </div>

      <div class="stat-grid" style="margin-bottom:18px;">
        <StatCard label="To Review" value={pending.length} color="yellow" />
        <StatCard label="Reviewed" value={reviewed.length - appealed} color="green" />
        <StatCard label="Appealed" value={appealed} color="blue" />
      </div>

      <div class="card" style="padding:14px 18px;">
        <form
          id="vo-filters"
          style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:12px;"
          hx-get="/api/vo/queue"
          hx-target="#vo-queue-table"
          hx-swap="innerHTML"
          hx-trigger="change, submit"
        >
          <div class="form-group vo-window" style="margin-bottom:0;">
            <label class="vo-filter-label">Window</label>
            <DateRangePicker
              since={params.since}
              until={params.until}
              sinceInputId="vo-since"
              untilInputId="vo-until"
              pageInputId=""
              formId="vo-filters"
              targetId="vo-queue-table"
              endpoint="/api/vo/queue"
            />
          </div>
          <input type="hidden" name="since" id="vo-since" value={String(params.since)} />
          <input type="hidden" name="until" id="vo-until" value={String(params.until)} />
          {/* The team-member buttons below write the choice into this. */}
          <input type="hidden" name="member" id="vo-member" value={params.member} />
          <div class="form-group vo-sale" style="margin-bottom:0;">
            <label class="vo-filter-label">Sale</label>
            <div style="display:flex;gap:12px;align-items:center;height:34px;">
              <label style="display:flex;gap:5px;align-items:center;font-size:12px;cursor:pointer;">
                <input type="checkbox" name="wgs" value="1" checked={params.wgs} /> WGS
              </label>
              <label style="display:flex;gap:5px;align-items:center;font-size:12px;cursor:pointer;">
                <input type="checkbox" name="mcc" value="1" checked={params.mcc} /> MCC
              </label>
            </div>
          </div>
          {/* Follows the department's question order (REQ-055); only a
              manager can change that order. */}
          {renderByQuestionToggle(params.byq, "vo-byq")}
          {asEmail && <input type="hidden" name="as" value={asEmail} />}
        </form>

        <div id="vo-member-buttons">{renderVoMemberButtons(items, params)}</div>

        <div class="rem-split">
          <section class="rem-split-pane">
            <div class="tbl-title" style="margin-bottom:10px;">To Review</div>
            {/* The URL follows the filters (replaceState) so Back from an audit
                restores the exact view. */}
            <div
              id="vo-queue-table"
              {...{ "hx-on::after-swap": "history.replaceState(null,'','/vo?'+new URLSearchParams(new FormData(document.getElementById('vo-filters'))).toString())" }}
            >
              {renderVoQueueResults(pendingRows, questionOrders)}
            </div>
          </section>
          <section class="rem-split-pane">
            <div class="tbl-title" style="margin-bottom:10px;">Reviewed</div>
            <div id="vo-reviewed-table">{renderVoReviewedResults(reviewedRows)}</div>
          </section>
        </div>
      </div>

      {renderVoReviewModal({ asEmail, inPlace: true })}
    </Layout>
  );
});
