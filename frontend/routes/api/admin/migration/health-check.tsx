/** HTMX fragment: comprehensive migration health check.
 *
 *  Answers three questions in one shot:
 *  1. What jobs are running? (top of report)
 *  2. What writes are left? (per-bucket: prodCount + samplesMissing → which buckets need re-write)
 *  3. Is everything operating correctly? (status per bucket: healthy / missing-data / mismatched-data) */
import { define } from "../../../../lib/define.ts";
import { apiPost } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";

interface HealthBucket {
  type: string;
  org: string;
  prodCount: number;
  isChunked: boolean;
  samplesChecked: number;
  samplesMatched: number;
  samplesMissing: number;
  samplesMismatched: number;
  status: "healthy" | "missing-data" | "mismatched-data" | "skipped" | "error";
  notes: string[];
}

interface HealthRunningJob {
  jobId: string;
  phase: string;
  status: string;
  mode: string;
  startedAt: number;
  message: string;
}

interface HealthReport {
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  totalBuckets: number;
  healthyBuckets: number;
  unhealthyBuckets: number;
  totalSamplesChecked: number;
  totalSamplesMatched: number;
  totalSamplesMissing: number;
  totalSamplesMismatched: number;
  buckets: HealthBucket[];
  runningJobs: HealthRunningJob[];
  source: string;
  sourceJobId?: string;
  notes: string[];
}

interface HealthResponse {
  ok: boolean;
  report?: HealthReport;
  error?: string;
}

export const handler = define.handlers({
  async POST(ctx) {
    let r: HealthResponse;
    try {
      r = await apiPost<HealthResponse>("/admin/migration/health-check", ctx.req, {});
    } catch (e) {
      return new Response(`<div class="error-text">health check failed: ${String(e)}</div>`, { headers: { "content-type": "text/html" } });
    }
    if (!r.ok || !r.report) {
      return new Response(`<div class="error-text">health check error: ${r.error ?? "unknown"}</div>`, { headers: { "content-type": "text/html" } });
    }
    return new Response(renderToString(<HealthReportView report={r.report} />), {
      headers: { "content-type": "text/html" },
    });
  },
});

function HealthReportView({ report }: { report: HealthReport }) {
  const allHealthy = report.unhealthyBuckets === 0 && report.totalSamplesMissing === 0 && report.totalSamplesMismatched === 0;
  const headerColor = allHealthy ? "#22c55e" : "#fbbf24";
  const headerBg = allHealthy ? "rgba(34,197,94,0.12)" : "rgba(251,191,36,0.12)";

  const sortedBuckets = [...report.buckets].sort((a, b) => statusRank(a.status) - statusRank(b.status));

  return (
    <div style="border:1px solid var(--border);border-radius:6px;padding:12px;background:var(--bg);font-size:11px;">
      <div style={`padding:8px 12px;border-radius:4px;background:${headerBg};color:${headerColor};font-weight:700;font-size:13px;margin-bottom:10px;`}>
        {allHealthy ? "🟢 ALL HEALTHY" : `🟡 ${report.unhealthyBuckets} BUCKET(S) NEED ATTENTION`}
        <span style="margin-left:12px;font-weight:400;color:var(--text-dim);font-size:11px;">
          finished in {Math.round(report.durationMs / 1000)}s · source: {report.source}{report.sourceJobId ? ` (${report.sourceJobId.slice(-6)})` : ""}
        </span>
      </div>

      <div style="display:grid;grid-template-columns:repeat(5, 1fr);gap:8px;margin-bottom:12px;">
        <Stat label="Buckets" v={report.totalBuckets} />
        <Stat label="Healthy" v={report.healthyBuckets} green />
        <Stat label="Need Attn" v={report.unhealthyBuckets} red={report.unhealthyBuckets > 0} />
        <Stat label="Samples Matched" v={report.totalSamplesMatched} green />
        <Stat label="Samples Missing" v={report.totalSamplesMissing} red={report.totalSamplesMissing > 0} />
      </div>

      {report.runningJobs.length > 0 ? (
        <div style="margin-bottom:12px;">
          <div style="font-weight:600;color:var(--text-bright);margin-bottom:4px;">⚡ Running Jobs ({report.runningJobs.length})</div>
          <table style="width:100%;font-family:monospace;font-size:10px;border-collapse:collapse;">
            <thead>
              <tr style="color:var(--text-dim);text-align:left;border-bottom:1px solid var(--border);">
                <th style="padding:3px 6px;">Job ID</th>
                <th style="padding:3px 6px;">Mode</th>
                <th style="padding:3px 6px;">Phase</th>
                <th style="padding:3px 6px;">Started</th>
                <th style="padding:3px 6px;">Message</th>
              </tr>
            </thead>
            <tbody>
              {report.runningJobs.map((j) => (
                <tr style="border-bottom:1px solid rgba(28,35,51,0.4);">
                  <td style="padding:3px 6px;">{j.jobId}</td>
                  <td style="padding:3px 6px;">{j.mode}</td>
                  <td style="padding:3px 6px;">{j.phase}</td>
                  <td style="padding:3px 6px;color:var(--text-dim);">{fmtAge(j.startedAt)}</td>
                  <td style="padding:3px 6px;color:var(--text-dim);">{j.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style="margin-bottom:12px;color:var(--text-dim);font-size:11px;">no migration jobs currently running</div>
      )}

      {report.notes.length > 0 && (
        <div style="margin-bottom:8px;color:var(--text-dim);font-size:10px;">
          {report.notes.map((n) => <div>· {n}</div>)}
        </div>
      )}

      <div style="font-weight:600;color:var(--text-bright);margin-bottom:4px;">🪣 Bucket Health ({sortedBuckets.length})</div>
      <div style="max-height:520px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;">
        <table style="width:100%;font-family:monospace;font-size:10px;border-collapse:collapse;">
          <thead style="position:sticky;top:0;background:var(--bg);">
            <tr style="color:var(--text-dim);text-align:left;border-bottom:1px solid var(--border);">
              <th style="padding:4px 6px;">Bucket</th>
              <th style="padding:4px 6px;text-align:right;">Prod</th>
              <th style="padding:4px 6px;text-align:right;">Sampled</th>
              <th style="padding:4px 6px;text-align:right;">Match</th>
              <th style="padding:4px 6px;text-align:right;">Missing</th>
              <th style="padding:4px 6px;">Status</th>
              <th style="padding:4px 6px;">Notes</th>
            </tr>
          </thead>
          <tbody>
            {sortedBuckets.map((b) => (
              <tr style="border-bottom:1px solid rgba(28,35,51,0.4);">
                <td style="padding:4px 6px;color:var(--text);">{b.type}/<span style="color:var(--text-dim);">{b.org || "·"}</span>{b.isChunked && <span style="color:var(--text-muted);"> [chunked]</span>}</td>
                <td style="padding:4px 6px;text-align:right;">{b.prodCount.toLocaleString()}</td>
                <td style="padding:4px 6px;text-align:right;">{b.samplesChecked}</td>
                <td style="padding:4px 6px;text-align:right;color:#22c55e;">{b.samplesMatched}</td>
                <td style={`padding:4px 6px;text-align:right;color:${b.samplesMissing > 0 ? "var(--red)" : "var(--text-dim)"};`}>{b.samplesMissing}</td>
                <td style="padding:4px 6px;">{statusBadge(b.status)}</td>
                <td style="padding:4px 6px;color:var(--text-dim);font-size:9px;">{b.notes.slice(0, 2).join("; ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, v, green, red }: { label: string; v: number; green?: boolean; red?: boolean }) {
  const color = green ? "#22c55e" : red ? "var(--red)" : "var(--text-bright)";
  return (
    <div>
      <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;">{label}</div>
      <div style={`font-size:14px;font-weight:700;color:${color};`}>{v.toLocaleString()}</div>
    </div>
  );
}

function statusRank(s: HealthBucket["status"]): number {
  switch (s) {
    case "missing-data": return 0;
    case "mismatched-data": return 1;
    case "error": return 2;
    case "healthy": return 3;
    case "skipped": return 4;
    default: return 5;
  }
}

function statusBadge(s: HealthBucket["status"]): VNode {
  let bg = "var(--border)", color = "var(--text-dim)", icon = "·", text: string = s;
  if (s === "healthy") { bg = "rgba(34,197,94,0.12)"; color = "#22c55e"; icon = "✓"; text = "healthy"; }
  else if (s === "missing-data") { bg = "rgba(248,81,73,0.12)"; color = "var(--red)"; icon = "✗"; text = "missing"; }
  else if (s === "mismatched-data") { bg = "rgba(251,191,36,0.12)"; color = "#fbbf24"; icon = "⚠"; text = "mismatch"; }
  else if (s === "skipped") { bg = "var(--border)"; color = "var(--text-dim)"; icon = "⊘"; text = "skipped"; }
  else if (s === "error") { bg = "rgba(248,81,73,0.12)"; color = "var(--red)"; icon = "✗"; text = "error"; }
  return (
    <span style={`display:inline-flex;align-items:center;gap:3px;padding:1px 6px;background:${bg};color:${color};border-radius:3px;font-weight:600;`}>
      <span>{icon}</span><span>{text}</span>
    </span>
  );
}

function fmtAge(ts: number): string {
  const ms = Date.now() - ts;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m - h * 60}m ago`;
}
