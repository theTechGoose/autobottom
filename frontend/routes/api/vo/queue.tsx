/** VO dashboard tables + the HTMX fragment that refreshes them (REQ-034..041).
 *
 *  The same split the Manager Portal uses — open work on the left, closed on
 *  the right, one filter bar — with Review (a required write-up) where the
 *  manager has Remediate / Skip. The filters are only the date window, the
 *  team-member buttons and WGS / MCC (REQ-040). */
import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { JSX } from "preact";
import {
  filterAndSortQueue, fmtTsEasternShort, fmtWhen, pillColor, renderMemberButtons, scoreOf, teamMemberLabel,
  type QueueFilterParams, type QueueItem,
} from "../manager/queue.tsx";
import { splitVoQueue, voClosedAt, voDefaultWindow } from "@core/business/tm-review/mod.ts";

export type VoQueueItem = QueueItem;

export interface VoFilterParams {
  member: string;
  wgs: boolean;
  mcc: boolean;
  since: number;
  until: number;
}

/** Filters off a query string; the window defaults to the most recent Monday
 *  (voDefaultWindow) when absent. since=0 means all time. */
export function readVoFilterParams(sp: URLSearchParams, now = Date.now()): VoFilterParams {
  const ms = (v: string | null) => (v == null || v === "" || !Number.isFinite(Number(v)) ? undefined : Number(v));
  const def = voDefaultWindow(now);
  return {
    member: sp.get("member") ?? "",
    wgs: sp.get("wgs") === "1",
    mcc: sp.get("mcc") === "1",
    since: ms(sp.get("since")) ?? def.since,
    until: ms(sp.get("until")) ?? def.until,
  };
}

const asQueueParams = (p: VoFilterParams): QueueFilterParams => ({ ...p, q: "", sort: "recent", dept: "" });

/** To Review rows in the window, newest first. */
export function filterVoPending(items: VoQueueItem[], p: VoFilterParams): VoQueueItem[] {
  return filterAndSortQueue(splitVoQueue(items).pending, asQueueParams(p));
}

/** Reviewed rows, newest review first. Like the manager's Completed side, the
 *  window applies to WHEN it was closed out and is open-ended at the top, so a
 *  review submitted after the page loaded still shows. */
export function filterVoReviewed(items: VoQueueItem[], p: VoFilterParams): VoQueueItem[] {
  const member = p.member.trim().toLowerCase();
  return splitVoQueue(items).reviewed
    .filter((it) => {
      if (p.since > 0 && voClosedAt(it) < p.since) return false;
      if (member && !teamMemberLabel(it).toLowerCase().includes(member)) return false;
      if ((p.wgs || p.mcc) && !((p.wgs && it.wgs) || (p.mcc && it.mcc))) return false;
      return true;
    })
    .sort((a, b) => voClosedAt(b) - voClosedAt(a));
}

/** Row click → the audit's page. `back` carries the filtered view so the
 *  review / Back lands where you were; `as` keeps an admin's VO View. */
const ROW_OPEN_JS =
  "var q=new URLSearchParams();"
  + "q.set('back',location.pathname+location.search);"
  + "var a=new URLSearchParams(location.search).get('as');if(a)q.set('as',a);"
  + "location.href='/vo/audit/'+encodeURIComponent(this.dataset.findingId)+'?'+q.toString()";

/** Review button → the page's review modal, primed with this row's id. */
const REVIEW_OPEN_JS =
  "event.stopPropagation();document.getElementById('vo-review-modal')?.classList.add('open');"
  + "document.getElementById('vo-rev-findingId').value=this.dataset.findingId;"
  + "var rt=document.getElementById('vo-rev-returnTo');if(rt)rt.value=location.pathname+location.search";

const dim = (text: string) => <span style="color:var(--text-dim);font-size:11px;">{text}</span>;

function failsCell(item: VoQueueItem): JSX.Element {
  const fails = item.failedQuestions ?? [];
  if (fails.length === 0) return dim(item.invalidGenie ? "no audio to grade" : "—");
  return (
    <div style="font-size:11px;color:var(--text-muted);max-width:160px;">
      {fails.slice(0, 2).map((q) => <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{q}</div>)}
      {fails.length > 2 && <div style="color:var(--text-dim);">+{fails.length - 2} more</div>}
    </div>
  );
}

function scoreCell(item: VoQueueItem): JSX.Element | string {
  if (item.invalidGenie) return dim("not graded");
  const score = scoreOf(item);
  if (score != null) return <span class={`pill pill-${pillColor(score)}`}>{score}%</span>;
  return item.failedCount != null ? <span class="pill pill-red">{item.failedCount} failed</span> : "—";
}

/** To Review — open audits with a Review button (never Remediate / Skip). */
export function renderVoQueueTable(rows: VoQueueItem[]): JSX.Element {
  return (
    <table class="data-table data-table-compact">
      <thead><tr><th>Team Member</th><th>Failed Questions</th><th>Score</th><th>Timestamp</th><th>Action</th></tr></thead>
      <tbody>
        {rows.length === 0
          ? <tr class="empty-row"><td colSpan={5}>Nothing to review</td></tr>
          : rows.map((item) => (
            <tr key={item.findingId} data-finding-id={item.findingId} style="cursor:pointer;" title="Open this audit" {...{ "hx-on:click": ROW_OPEN_JS }}>
              <td><div class="tm-cell"><span>{teamMemberLabel(item)}</span>
                {item.invalidGenie && <span class="pill pill-purple" style="font-size:9px;">Invalid genie</span>}
              </div></td>
              <td>{failsCell(item)}</td>
              <td>{scoreCell(item)}</td>
              <td style="font-size:12px;color:var(--text-muted);white-space:nowrap;">{fmtTsEasternShort(item.completedAt ?? item.addedAt)}</td>
              <td {...{ "hx-on:click": "event.stopPropagation()" }}>
                <button type="button" class="btn btn-ghost btn-sm vo-review-btn" data-finding-id={item.findingId} {...{ "hx-on:click": REVIEW_OPEN_JS }}>Review</button>
              </td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}

/** Reviewed — what was written, by whom, and whether the manager has since
 *  remediated it (a read-only box, REQ-036). An audit taken off the queue by an
 *  appeal / new recording lands here too, flagged as such (REQ-037). */
export function renderVoReviewedTable(rows: VoQueueItem[]): JSX.Element {
  return (
    <table class="data-table data-table-compact">
      <thead><tr><th>Team Member</th><th>Outcome</th><th>By</th><th>When</th><th>Write-up</th><th>Remediated</th></tr></thead>
      <tbody>
        {rows.length === 0
          ? <tr class="empty-row"><td colSpan={6}>Nothing reviewed in this range</td></tr>
          : rows.map((item) => {
            const r = item.tmReview;
            const by = r?.reviewedBy || item.appealedBy || "—";
            const note = r?.note || item.appealNote || "";
            const remediated = item.status === "remediated";
            return (
              <tr key={item.findingId} data-finding-id={item.findingId} style="cursor:pointer;" title="Open this audit" {...{ "hx-on:click": ROW_OPEN_JS }}>
                <td><div class="tm-cell"><span>{teamMemberLabel(item)}</span></div></td>
                <td><div class="outcome-cell">
                  {r && <span class="pill pill-green">Reviewed</span>}
                  {item.appealState && (
                    <span class={`pill pill-${item.appealState === "re-audited" ? "blue" : "yellow"}`}>
                      {item.appealState === "re-audited" ? "Re-Audited" : "Appealed"}
                    </span>
                  )}
                </div></td>
                <td class="rem-by-cell" style="font-size:12px;" title={by}>{by.split("@")[0]}</td>
                <td style="font-size:12px;color:var(--text-muted);white-space:nowrap;">{fmtWhen(voClosedAt(item) || undefined)}</td>
                <td class="rem-note-cell">
                  {note
                    ? <><span class="rem-note-line">{note}</span><span class="rem-note-pop" role="tooltip">{note}</span></>
                    : dim("—")}
                </td>
                <td {...{ "hx-on:click": "event.stopPropagation()" }}>
                  <input type="checkbox" disabled checked={remediated} data-remediated={String(remediated)} aria-label="Remediated" />
                </td>
              </tr>
            );
          })}
      </tbody>
    </table>
  );
}

/** The audit page's Review control (REQ-035): a button + its modal while the
 *  audit is unreviewed, a stamp of who reviewed it once it is. Nothing for an
 *  audit that isn't in this login's queue. */
export function renderVoReviewAction(opts: { item: VoQueueItem | null; findingId: string; returnTo: string; asEmail?: string }) {
  const { item, findingId, returnTo, asEmail } = opts;
  if (!item) return { action: null, modal: null };
  if (item.tmReview) {
    return {
      action: <span class="rem-done vo-reviewed-stamp" title={item.tmReview.note}>Reviewed by {item.tmReview.reviewedBy}</span>,
      modal: null,
    };
  }
  return {
    action: (
      <button type="button" class="btn btn-primary btn-sm" {...{ "hx-on:click": "document.getElementById('vo-review-modal')?.classList.add('open')" }}>Review</button>
    ),
    modal: renderVoReviewModal({ findingId, returnTo, asEmail, teamMember: teamMemberLabel(item) }),
  };
}

/** The review form. On the dashboard the Review button fills in the id; on an
 *  audit page it is baked in. */
export function renderVoReviewModal(opts: { findingId?: string; returnTo?: string; asEmail?: string; teamMember?: string; inPlace?: boolean }) {
  return (
    <div id="vo-review-modal" class="modal-overlay">
      <div class="modal" style="width:min(520px,92vw);">
        <div class="modal-title">Review Audit</div>
        <div class="modal-sub" style="margin-bottom:14px;">
          Write up what you reviewed{opts.teamMember && opts.teamMember !== "—" ? ` with ${opts.teamMember}` : ""}. Once submitted it is final for everyone on this login.
        </div>
        {/* On the dashboard (`inPlace`) a saved review re-renders the two
            tables where they are — the filter bar rides along so the view
            keeps its filters — and the modal closes. On an audit page it goes
            back to the queue instead. */}
        <form
          hx-post="/api/vo/review"
          hx-target="#vo-review-error"
          hx-swap="innerHTML"
          {...(opts.inPlace ? {
            "hx-include": "#vo-filters",
            "hx-on::after-request": "if(event.detail.successful&&event.detail.xhr.getResponseHeader('HX-Trigger')==='vo-reviewed'){this.reset();this.closest('.modal-overlay').classList.remove('open')}",
          } : {})}
        >
          {opts.inPlace && <input type="hidden" name="inplace" value="1" />}
          <input type="hidden" id="vo-rev-findingId" name="findingId" value={opts.findingId ?? ""} />
          <input type="hidden" id="vo-rev-returnTo" name="returnTo" value={opts.returnTo ?? ""} />
          {opts.asEmail && <input type="hidden" name="as" value={opts.asEmail} />}
          <div class="form-group">
            <label>What you reviewed</label>
            <textarea name="note" class="vo-review-note" rows={5} required placeholder="What you went over from this audit…"></textarea>
          </div>
          <div id="vo-review-error" class="auth-error"></div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" {...{ "hx-on:click": "this.closest('.modal-overlay').classList.remove('open')" }}>Cancel</button>
            <button type="submit" class="btn btn-primary">Submit</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Caption + To Review table — rendered by the page and the fragment alike. */
export function renderVoQueueResults(rows: VoQueueItem[]): JSX.Element {
  return (
    <>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">
        <strong style="color:var(--text-muted);">{rows.length}</strong> {rows.length === 1 ? "audit" : "audits"} to review in the selected range
      </div>
      {renderVoQueueTable(rows)}
    </>
  );
}

export function renderVoReviewedResults(rows: VoQueueItem[]): JSX.Element {
  return (
    <>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">
        <strong style="color:var(--text-muted);">{rows.length}</strong> reviewed or appealed in the selected range
      </div>
      {renderVoReviewedTable(rows)}
    </>
  );
}

const VO_MEMBER_TARGET = { endpoint: "/api/vo/queue", form: "#vo-filters", table: "#vo-queue-table", memberInput: "vo-member" };

export function renderVoMemberButtons(items: VoQueueItem[], p: VoFilterParams): JSX.Element {
  return renderMemberButtons(splitVoQueue(items).pending, asQueueParams(p), VO_MEMBER_TARGET);
}

/** The refresh fragment: To Review into #vo-queue-table, with the member
 *  buttons and the Reviewed side as out-of-band swaps. Shared by the filter
 *  refresh and an in-place review submit. */
export async function renderVoFragment(req: Request, sp: URLSearchParams): Promise<string> {
  const asEmail = sp.get("as");
  const { items } = await apiFetch<{ items: VoQueueItem[] }>(`/vo/api/queue${asEmail ? `?as=${encodeURIComponent(asEmail)}` : ""}`, req);
  const p = readVoFilterParams(sp);
  return renderToString(
    <>
      {renderVoQueueResults(filterVoPending(items ?? [], p))}
      <div id="vo-member-buttons" hx-swap-oob="true">{renderVoMemberButtons(items ?? [], p)}</div>
      <div id="vo-reviewed-table" hx-swap-oob="true">{renderVoReviewedResults(filterVoReviewed(items ?? [], p))}</div>
    </>,
  );
}

export const handler = define.handlers({
  async GET(ctx) {
    try {
      const html = await renderVoFragment(ctx.req, new URL(ctx.req.url).searchParams);
      return new Response(html, { headers: { "content-type": "text/html" } });
    } catch {
      return new Response(`<div class="placeholder-card">Failed to load the queue</div>`, { headers: { "content-type": "text/html" } });
    }
  },
});
