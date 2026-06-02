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
import { renderToString } from "preact-render-to-string";

interface Resp {
  total: number; sent: number; opened: number; clicked: number; appealed: number;
  appealedAmongOpened: number; appealedAmongClicked: number;
  openRate: number; clickRate: number; appealRateAll: number; appealRateOpened: number; appealRateClicked: number;
}

function startOfMonth(offset: number): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1);
}

function dateToMs(dateStr: string, endOfDay: boolean): number | null {
  if (!dateStr) return null;
  const ts = Date.parse(dateStr + "T00:00:00Z");
  if (!Number.isFinite(ts)) return null;
  return endOfDay ? ts + 86_400_000 - 1 : ts;
}

interface Resolved { since: number; until: number; label: string }

function resolveRange(preset: string, customFrom: string, customTo: string): Resolved {
  const now = Date.now();
  switch (preset) {
    case "this-month": return { since: startOfMonth(0), until: now, label: "This Month" };
    case "last-month": return { since: startOfMonth(-1), until: startOfMonth(0) - 1, label: "Last Month" };
    case "last-3": return { since: startOfMonth(-2), until: now, label: "Last 3 Months" };
    case "last-6": return { since: startOfMonth(-5), until: now, label: "Last 6 Months" };
    case "all-time": return { since: 0, until: now, label: "All Time" };
    case "custom": {
      const since = dateToMs(customFrom, false);
      const until = dateToMs(customTo, true);
      if (since != null && until != null) return { since, until, label: `${customFrom} → ${customTo}` };
      if (since != null) return { since, until: now, label: `${customFrom} → now` };
      if (until != null) return { since: 0, until, label: `epoch → ${customTo}` };
      return { since: startOfMonth(0), until: now, label: "This Month (no custom range)" };
    }
    default: return { since: startOfMonth(0), until: now, label: "This Month" };
  }
}

function RateCard({ title, rate, appealLabel, appealRate, accent }: { title: string; rate: number; appealLabel: string; appealRate: number; accent: string }) {
  return (
    <div style={`border:1px solid var(--border);border-left:3px solid ${accent};border-radius:8px;padding:14px;background:var(--bg-2);`}>
      <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">{title}</div>
      <div style={`font-size:28px;font-weight:800;color:${accent};font-variant-numeric:tabular-nums;`}>{rate}%</div>
      <div style="font-size:11px;color:var(--text-dim);margin-top:8px;">{appealLabel} <strong style="color:var(--text-bright);">{appealRate}%</strong></div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style="border:1px solid var(--border);border-radius:6px;padding:10px;background:var(--bg);">
      <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">{label}</div>
      <div style={`font-size:18px;font-weight:700;color:${color ?? "var(--text-bright)"};font-variant-numeric:tabular-nums;`}>{value.toLocaleString()}</div>
    </div>
  );
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
      <div style="font-size:12px;font-weight:700;color:var(--text-bright);margin-bottom:12px;">
        Email Engagement — {label} · {r.total.toLocaleString()} audits
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
    const preset = sp.get("preset") ?? "this-month";
    const html = await renderEngagement(ctx.req, preset, sp.get("custom-from") ?? "", sp.get("custom-to") ?? "");
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
  async POST(ctx) {
    const form = await ctx.req.formData();
    const preset = String(form.get("preset") ?? "this-month");
    const customFrom = String(form.get("custom-from") ?? "");
    const customTo = String(form.get("custom-to") ?? "");
    const html = await renderEngagement(ctx.req, preset, customFrom, customTo);
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
