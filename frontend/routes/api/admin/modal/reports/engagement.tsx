/** Email Engagement report fragment — POSTed from the preset bar / custom range
 *  form in /api/admin/modal/reports (and GET for the initial load). Resolves the
 *  range to ms bounds, calls /admin/email-engagement/data, and renders the
 *  co-headline open-rate / click-rate cards.
 *
 *  Cohort = audits completed in the window (audit-done-idx). Opens are
 *  prefetch-filtered (Apple MPP <10s discarded) and deduped per recipient;
 *  clicks are exact human engagement. */

import { define } from "../../../../../lib/define.ts";
import { apiFetch } from "../../../../../lib/api.ts";
import { resolveRange } from "../../../../../lib/report-range.ts";
import { MiniStat, RateCard } from "../../../../../components/EngagementCards.tsx";
import { renderToString } from "preact-render-to-string";

interface Resp {
  total: number; sent: number; opened: number; clicked: number; appealed: number;
  appealedAmongOpened: number; appealedAmongClicked: number;
  openRate: number; clickRate: number; appealRateAll: number; appealRateOpened: number; appealRateClicked: number;
}

async function renderEngagement(req: Request, preset: string, customFrom: string, customTo: string): Promise<string> {
  const { since, until, label } = resolveRange(preset, customFrom, customTo);
  let r: Resp;
  try {
    r = await apiFetch<Resp>(`/admin/email-engagement/data?since=${since}&until=${until}`, req);
  } catch (e) {
    return renderToString(
      <div class="error-text" style="font-size:11px;padding:10px;border:1px solid var(--red);border-radius:6px;">
        Failed: {String((e as Error).message ?? e)}
      </div>,
    );
  }

  return renderToString(
    <div style="border:1px solid var(--border);border-radius:6px;padding:14px;background:var(--bg);">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;">
        <div style="font-size:12px;font-weight:700;color:var(--text-bright);">
          Email Engagement — {label} · {r.total.toLocaleString()} audits
        </div>
        <a
          href={`/admin/email-engagement?since=${since}&until=${until}`}
          target="_blank"
          rel="noopener"
          class="sf-btn ghost"
          style="font-size:11px;padding:4px 10px;text-decoration:none;white-space:nowrap;"
        >Open full report ↗</a>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
        <RateCard title="Open rate (opened ÷ sent)" rate={r.openRate} accent="var(--cyan)"
          appealLabel="Appeals ÷ opened:" appealRate={r.appealRateOpened} />
        <RateCard title="Click rate (clicked ÷ sent)" rate={r.clickRate} accent="var(--green)"
          appealLabel="Appeals ÷ clicked:" appealRate={r.appealRateClicked} />
      </div>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:10px;">
        <MiniStat label="Sent" value={r.sent} />
        <MiniStat label="Opened" value={r.opened} color="var(--cyan)" />
        <MiniStat label="Clicked" value={r.clicked} color="var(--green)" />
        <MiniStat label="Appealed" value={r.appealed} color="var(--yellow)" />
        <MiniStat label="Appeals ÷ all" value={r.appealRateAll} color="var(--text-bright)" />
      </div>
      <div style="font-size:10px;color:var(--text-dim);line-height:1.5;">
        Opens: Apple-Mail prefetch (&lt;10s) is filtered out and Gmail opens are deduped/geo-masked per recipient —
        a fuzzy-but-broad signal. Clicks: exact human engagement (scanner double-clicks absorbed by binary-per-finding) —
        clean-but-narrower. Engagement is recorded per finding; only audits whose email was actually sent count toward "sent".
      </div>
    </div>,
  );
}

export const handler = define.handlers({
  async GET(ctx) {
    const sp = new URL(ctx.req.url).searchParams;
    const preset = sp.get("preset") ?? "today";
    const html = await renderEngagement(ctx.req, preset, sp.get("custom-from") ?? "", sp.get("custom-to") ?? "");
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
  async POST(ctx) {
    const form = await ctx.req.formData();
    const preset = String(form.get("preset") ?? "today");
    const customFrom = String(form.get("custom-from") ?? "");
    const customTo = String(form.get("custom-to") ?? "");
    const html = await renderEngagement(ctx.req, preset, customFrom, customTo);
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
