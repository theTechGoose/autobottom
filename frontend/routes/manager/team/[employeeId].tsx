/** Individual team-member report — one person's audit history, keyed on their
 *  QuickBase employee id (fid 143), NOT their name or email.
 *
 *  Why the id: prod has two different Mariah Browns (one ODR, one WST) who also
 *  share a single VO email address, and 19% of names cover more than one
 *  employee record. A page keyed on either would silently blend two people's
 *  scores. See `AuditDoneIndexEntry.employeeId`.
 *
 *  Everything below the header is `renderAuditHistoryTable` — the SAME
 *  component /manager/audits renders. That is deliberate and load-bearing: the
 *  first cut of this page hand-rolled its own stat cards and table, which drifted
 *  from every other table in the app (it even put the `.tbl` CARD class on a
 *  <table>, so it got card styling and no table styling at all). Reusing the
 *  renderer means this page cannot drift again — restyle the audit tables once
 *  and this follows.
 *
 *  The hidden form below feeds that renderer's pagination, which refreshes via
 *  `htmx.ajax(... source:'#audit-history-filters')` exactly as it does on
 *  /manager/audits. It carries `employeeId` so a page-2 refresh stays scoped to
 *  this person.
 *
 *  The id only exists on audits ingested from 2026-08-07 onward. Older audits
 *  have no id and are NOT matched by name fallback — that fallback is exactly
 *  the bug this page exists to avoid — so the page says so out loud rather than
 *  quietly showing a short history as if it were complete. */
import { define } from "../../../lib/define.ts";
import { Layout } from "../../../components/Layout.tsx";
import { apiFetch } from "../../../lib/api.ts";
import {
  renderAuditHistoryTable,
  type AuditHistoryData,
  type AuditHistoryItem,
} from "../../api/manager/audit-history.tsx";

/** First audit ingested with an employee id (commit 388be51b, 2026-08-07
 *  09:42 EDT). Anything completed before this can't be on the page. */
const ID_LIVE_FROM_MS = 1786110125000;

const DAY = 86_400_000;
const WINDOWS = [
  { label: "30 days", days: 30 },
  { label: "60 days", days: 60 },
  { label: "90 days", days: 90 },
];

function safeMs(v: string | null, dflt: number): number {
  if (v == null || v === "") return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

function fmtDay(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Display name for the person. Every row in the set is the same employee, so
 *  the first row that carries a name wins; falls back to the id so the page
 *  still renders for an employee whose rows have no VoName. */
function personName(items: AuditHistoryItem[], employeeId: string): string {
  for (const it of items) {
    if (it.voName) return it.voName;
    if (it.owner && it.owner !== "api") return it.owner.split("@")[0];
  }
  return `Employee ${employeeId}`;
}

/** Every activating office this person booked under in the window. One person
 *  legitimately spans offices (40% of employees do), so this is a list, not a
 *  single "their department". */
function offices(items: AuditHistoryItem[]): string[] {
  return [...new Set(items.map((i) => i.department).filter(Boolean))].sort() as string[];
}

export default define.page(async function TeamMemberReportPage(ctx) {
  const user = ctx.state.user!;
  const url = new URL(ctx.req.url);
  const employeeId = String(ctx.params.employeeId ?? "").trim();

  const days = Math.max(1, Math.min(365, Number(url.searchParams.get("days")) || 30));
  const until = safeMs(url.searchParams.get("until"), Date.now());
  const since = safeMs(url.searchParams.get("since"), until - days * DAY);
  const page = String(Math.max(1, Number(url.searchParams.get("page")) || 1));
  const limit = "50";
  const asEmail = url.searchParams.get("as") ?? "";
  const asQs = asEmail ? `&as=${encodeURIComponent(asEmail)}` : "";
  const backQs = asEmail ? `?as=${encodeURIComponent(asEmail)}` : "";

  const qs = new URLSearchParams({ employeeId, since: String(since), until: String(until), page, limit });
  if (asEmail) qs.set("as", asEmail);

  let data: AuditHistoryData;
  let loadError = "";
  try {
    data = await apiFetch<AuditHistoryData>(`/manager/api/audit-history?${qs}`, ctx.req);
  } catch (e) {
    console.error("Team report load error:", e);
    loadError = (e as Error).message;
    data = { items: [], total: 0, pages: 1, page: 1, owners: [], shifts: [], departments: [] };
  }

  const items = data.items ?? [];
  const name = personName(items, employeeId);
  const depts = offices(items);
  // The window can start before employee ids existed. Saying "0 audits" for a
  // stretch we simply can't see would read as "this person did nothing".
  const windowPredatesIds = since < ID_LIVE_FROM_MS;

  return (
    <Layout title={name} section="manager" user={user} gameState={ctx.state.gameState} pathname={url.pathname}>
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;gap:16px;">
        <div>
          <h1>{name}</h1>
          <p class="page-sub">
            <span class="mono" style="color:var(--text-muted);">Employee #{employeeId}</span>
            {depts.length > 0 && <> &middot; {depts.join(", ")}</>}
            {" "}&middot; {fmtDay(since)} to {fmtDay(until)}
          </p>
        </div>
        <a href={`/manager/audits${backQs}`} class="btn btn-ghost btn-sm">&larr; Audit History</a>
      </div>

      {/* Window presets. Plain links — this page has exactly one filter and it
          belongs in the URL so a report can be shared or bookmarked. */}
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:14px;flex-wrap:wrap;">
        <span style="font-size:12px;color:var(--text-muted);">Window</span>
        {WINDOWS.map((w) => (
          <a
            key={w.days}
            href={`/manager/team/${encodeURIComponent(employeeId)}?days=${w.days}${asQs}`}
            class={`btn btn-sm ${w.days === days ? "" : "btn-ghost"}`}
          >{w.label}</a>
        ))}
      </div>

      {loadError && (
        <div class="card" style="padding:12px 16px;margin-bottom:14px;border-left:3px solid var(--red,#f85149);">
          <strong>Couldn't load this report.</strong>
          <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">{loadError}</div>
        </div>
      )}

      {windowPredatesIds && (
        <div class="card" style="padding:10px 16px;margin-bottom:14px;border-left:3px solid var(--yellow,#d29922);">
          <div style="font-size:13px;">
            This window starts before {fmtDay(ID_LIVE_FROM_MS)}, when audits began
            recording who they belong to. Anything audited earlier isn't counted here yet.
          </div>
        </div>
      )}

      {/* Hidden filter carrier. renderAuditHistoryTable's pagination refreshes
          with `source:'#audit-history-filters'`, so these inputs ARE the params
          that page-2 sends — employeeId included, or the refresh would fall
          back to the whole org. Mirrors the form on /manager/audits, minus the
          controls this page doesn't offer. */}
      <form id="audit-history-filters" style="display:none;">
        <input type="hidden" name="employeeId" value={employeeId} />
        <input type="hidden" name="since" value={String(since)} />
        <input type="hidden" name="until" value={String(until)} />
        <input type="hidden" name="limit" value={limit} />
        <input type="hidden" name="page" id="ah-page" value={page} />
        {asEmail && <input type="hidden" name="as" value={asEmail} />}
      </form>

      {/* The SAME renderer /manager/audits uses — summary line, most-missed
          card, table and pagination. Identical by construction, not by copy. */}
      <div id="audit-history-table">
        {renderAuditHistoryTable(data, { since, until })}
      </div>
    </Layout>
  );
});
