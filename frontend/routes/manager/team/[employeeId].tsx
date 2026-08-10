/** Individual team-member report — one person's audit history, keyed on their
 *  QuickBase employee id (fid 143), NOT their name or email.
 *
 *  Why the id: prod has two different Mariah Browns (one ODR, one WST) who also
 *  share a single VO email address, and 19% of names cover more than one
 *  employee record. A page keyed on either would silently blend two people's
 *  scores. See `AuditDoneIndexEntry.employeeId`.
 *
 *  Everything on the page comes from ONE call to /manager/api/audit-history
 *  with `employeeId` pinned — that response already scopes its stats,
 *  most-missed questions and rows to the filtered set, so no extra reads. The
 *  backing endpoint applies the caller's manager scope (dept/shift +
 *  reviewed-only), so a manager only ever sees their own team's people.
 *
 *  The id only exists on audits ingested from 2026-08-07 onward. Older audits
 *  have no id at all and are NOT matched by name fallback — that fallback is
 *  exactly the bug this page exists to avoid — so the page says so out loud
 *  rather than quietly showing a short history as if it were complete. */
import { define } from "../../../lib/define.ts";
import { Layout } from "../../../components/Layout.tsx";
import { apiFetch } from "../../../lib/api.ts";
import type { AuditHistoryData, AuditHistoryItem } from "../../api/manager/audit-history.tsx";

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

function scoreColor(score: number | null | undefined): string {
  if (score == null) return "var(--text-dim)";
  if (score >= 100) return "var(--green, #3fb950)";
  if (score >= 80) return "var(--yellow, #d29922)";
  return "var(--red, #f85149)";
}

function fmtDay(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
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
  const asEmail = url.searchParams.get("as") ?? "";
  const asQs = asEmail ? `&as=${encodeURIComponent(asEmail)}` : "";
  const backQs = asEmail ? `?as=${encodeURIComponent(asEmail)}` : "";

  const qs = new URLSearchParams({
    employeeId,
    since: String(since),
    until: String(until),
    limit: "100",
    page: url.searchParams.get("page") ?? "1",
  });
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
  const missed = data.topMissed ?? [];
  const scored = data.scoredCount ?? 0;
  const passed = data.passedCount ?? 0;
  const passRate = scored > 0 ? Math.round((passed / scored) * 1000) / 10 : null;
  // The window can start before employee ids existed. Saying "0 audits" for a
  // stretch we simply can't see would read as "this person did nothing".
  const windowPredatesIds = since < ID_LIVE_FROM_MS;

  const stat = (label: string, value: string, color?: string) => (
    <div class="stat-card">
      <div class="val" style={color ? `color:${color};` : ""}>{value}</div>
      <div class="lbl">{label}</div>
    </div>
  );

  return (
    <Layout title={name} section="manager" user={user} gameState={ctx.state.gameState} pathname={url.pathname}>
      {/* `.audits-stats` is page-scoped CSS on /admin/audits, not global — the
          cards stack full-width without this copy. Kept byte-identical to
          admin/audits.tsx so the two pages' stat rows stay visually the same. */}
      <style>{`
        .audits-stats { display:flex; gap:12px; margin-bottom:16px; flex-wrap:wrap; }
        .audits-stats .stat-card { background:var(--bg-raised); border:1px solid var(--border); border-radius:8px; padding:10px 16px; min-width:120px; }
        .audits-stats .stat-card .val { font-size:20px; font-weight:700; color:var(--text-bright); line-height:1; }
        .audits-stats .stat-card .lbl { font-size:10px; color:var(--text-muted); margin-top:3px; }
      `}</style>
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

      {/* Window presets. Plain links — no JS, no filter form; this page has
          exactly one filter and it belongs in the URL so a report can be
          shared or bookmarked. */}
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

      <div class="audits-stats" style="margin-bottom:14px;">
        {stat("Audits", String(data.total ?? 0))}
        {stat("Average Score", data.avgScore != null ? `${data.avgScore}%` : "—", scoreColor(data.avgScore))}
        {stat("Pass Rate", passRate != null ? `${passRate}%` : "—")}
        {stat("Failed", String(Math.max(0, scored - passed)))}
        {stat("WGS", String(data.wgsCount ?? 0))}
        {stat("MCC", String(data.mccCount ?? 0))}
      </div>

      {windowPredatesIds && (
        <div class="card" style="padding:10px 16px;margin-bottom:14px;border-left:3px solid var(--yellow,#d29922);">
          <div style="font-size:13px;">
            This window starts before {fmtDay(ID_LIVE_FROM_MS)}, when audits began
            recording who they belong to. Anything audited earlier isn't counted here yet.
          </div>
        </div>
      )}

      {/* What this person misses most — the coaching list. Already scoped to
          them by the employeeId filter, so no separate query. */}
      <div class="card" style="padding:14px 18px;margin-bottom:14px;">
        <div class="tbl-title" style="margin-bottom:10px;">Most Missed Questions</div>
        {missed.length === 0
          ? <div style="font-size:13px;color:var(--text-muted);">No failed questions in this window.</div>
          : (
            <div style="display:flex;flex-direction:column;gap:6px;">
              {missed.map((m, i) => (
                <div key={m.header} style="display:flex;align-items:center;gap:10px;font-size:13px;">
                  <span class="mono" style="color:var(--text-muted);width:18px;">{i + 1}.</span>
                  <span style="flex:1;">{m.header}</span>
                  <span class="pill pill-red">{m.count} {m.count === 1 ? "miss" : "misses"}</span>
                </div>
              ))}
            </div>
          )}
      </div>

      <div class="card" style="padding:14px 18px;">
        <div class="tbl-title" style="margin-bottom:10px;">Audits</div>
        {items.length === 0
          ? (
            <div style="font-size:13px;color:var(--text-muted);">
              No audits for this person in this window.
            </div>
          )
          : (
            <div style="overflow-x:auto;">
              <table class="tbl">
                <thead>
                  <tr>
                    <th>Completed</th>
                    <th>Record</th>
                    <th>Office</th>
                    <th>Shift</th>
                    <th style="text-align:right;">Score</th>
                    <th>Sale</th>
                    <th>Appeal</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.findingId}>
                      <td style="white-space:nowrap;">{fmtDateTime(it.ts)}</td>
                      <td class="mono">{it.recordId ?? "—"}</td>
                      <td>{it.department ?? "—"}</td>
                      <td>{it.shift ?? "—"}</td>
                      <td style={`text-align:right;font-weight:600;color:${scoreColor(it.score)};`}>
                        {it.score != null ? `${it.score}%` : "—"}
                      </td>
                      <td>
                        {it.wgs === undefined
                          ? <span style="color:var(--text-dim);font-size:11px;">—</span>
                          : [
                            ...(it.wgs ? ["WGS"] : []),
                            ...(it.mcc ? ["MCC"] : []),
                          ].length === 0
                          ? <span style="color:var(--text-dim);font-size:11px;">—</span>
                          : (
                            <span>
                              {[...(it.wgs ? ["WGS"] : []), ...(it.mcc ? ["MCC"] : [])].map((t) => (
                                <span key={t} class={`pill pill-${t === "WGS" ? "green" : "blue"}`} style="margin-right:4px;">{t}</span>
                              ))}
                            </span>
                          )}
                      </td>
                      <td>
                        {it.appealStatus === "pending"
                          ? <span class="pill pill-yellow">Pending</span>
                          : it.appealStatus === "complete"
                          ? <span class="pill pill-blue">Complete</span>
                          : <span style="color:var(--text-dim);font-size:11px;">—</span>}
                      </td>
                      <td>
                        <a
                          href={`/audit/report?id=${encodeURIComponent(it.findingId)}`}
                          class="btn btn-ghost btn-sm"
                        >Report</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

        {(data.pages ?? 1) > 1 && (
          <div style="display:flex;gap:8px;align-items:center;justify-content:center;margin-top:12px;">
            {(data.page ?? 1) > 1 && (
              <a
                href={`/manager/team/${encodeURIComponent(employeeId)}?days=${days}&page=${(data.page ?? 1) - 1}${asQs}`}
                class="btn btn-ghost btn-sm"
              >&larr; Prev</a>
            )}
            <span style="font-size:12px;color:var(--text-muted);">Page {data.page ?? 1} of {data.pages}</span>
            {(data.page ?? 1) < (data.pages ?? 1) && (
              <a
                href={`/manager/team/${encodeURIComponent(employeeId)}?days=${days}&page=${(data.page ?? 1) + 1}${asQs}`}
                class="btn btn-ghost btn-sm"
              >Next &rarr;</a>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
});
