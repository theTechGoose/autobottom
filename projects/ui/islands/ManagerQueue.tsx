import { useSignal, useComputed } from "@preact/signals";
import { useEffect } from "preact/hooks";

interface QueueItem {
  findingId: string;
  owner: string;
  recordId: string;
  failedCount: number;
  totalQuestions: number;
  completedAt: number;
  status: "pending" | "addressed";
}

interface Stats {
  outstanding: number;
  addressedThisWeek: number;
  total: number;
  avgResolutionMs: number;
}

interface Question {
  index: number;
  header: string;
  answer: string;
  reviewDecision: string;
  defense?: string;
  thinking?: string;
  snippet?: string;
  reviewer?: string;
}

interface Transcript {
  diarized?: string;
  raw?: string;
}

interface Remediation {
  notes: string;
  addressedBy: string;
  addressedAt: number;
}

interface Finding {
  id: string;
  owner: string;
  recordingId: string;
  recordId?: string;
  record?: Record<string, unknown>;
}

interface DetailData {
  finding: Finding;
  questions: Question[];
  transcript: Transcript | null;
  remediation: Remediation | null;
  queueItem: QueueItem | null;
}

interface GameState {
  level: number;
  totalXp: number;
  tokenBalance: number;
  badges: string[];
}

const LEVEL_THRESHOLDS = [0, 100, 300, 600, 1000, 1500, 2200, 3200, 4500, 6500];

const MGR_BADGES = [
  { id: "mgr_first_fix", name: "First Response", tier: "common", description: "Submit your first remediation" },
  { id: "mgr_fifty", name: "Firefighter", tier: "uncommon", description: "Remediate 50 items" },
  { id: "mgr_two_hundred", name: "Zero Tolerance", tier: "rare", description: "Remediate 200 items" },
  { id: "mgr_fast_24h", name: "Rapid Response", tier: "uncommon", description: "Remediate 10 items within 24h" },
  { id: "mgr_fast_1h", name: "Lightning Manager", tier: "rare", description: "Remediate 5 items within 1h" },
  { id: "mgr_clear_queue", name: "Queue Slayer", tier: "rare", description: "Clear entire queue to zero" },
  { id: "mgr_streak_5", name: "Consistent Manager", tier: "uncommon", description: "5-day remediation streak" },
  { id: "mgr_streak_20", name: "Relentless", tier: "rare", description: "20-day remediation streak" },
  { id: "mgr_mentor", name: "Team Builder", tier: "epic", description: "All agents above 80% pass rate" },
];

const TIER_COLORS: Record<string, string> = {
  common: "#6b7280", uncommon: "#22c55e", rare: "#3b82f6", epic: "#a855f7", legendary: "#f59e0b",
};

function fmt(n: number | undefined): string {
  if (n === undefined || n === null) return "--";
  return n.toLocaleString();
}

function formatDuration(ms: number | undefined): string {
  if (!ms) return "--";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 24) return Math.floor(h / 24) + "d";
  if (h > 0) return h + "h " + m + "m";
  return m + "m";
}

function formatDate(ts: number): string {
  if (!ts) return "--";
  return new Date(ts).toLocaleDateString();
}

function Toast({ msg, type, onDone }: { msg: string; type: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2400);
    return () => clearTimeout(t);
  }, []);
  return (
    <div class={`toast ${type}`} style="position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:1000;padding:8px 20px;border-radius:10px;font-size:13px;font-weight:600;backdrop-filter:blur(16px);box-shadow:0 8px 32px rgba(0,0,0,0.5);display:flex;align-items:center;gap:8px;background:rgba(18,22,30,0.95);color:var(--blue);border:1px solid rgba(88,166,255,0.2);">
      <span style="width:6px;height:6px;border-radius:50%;background:var(--blue);flex-shrink:0;display:inline-block;"></span>
      {msg}
    </div>
  );
}

export default function ManagerQueue() {
  const screen = useSignal<"queue" | "detail" | "stats" | "users" | "events">("queue");
  const queueData = useSignal<QueueItem[]>([]);
  const stats = useSignal<Stats | null>(null);
  const filterVal = useSignal<"all" | "pending" | "addressed">("all");
  const detail = useSignal<DetailData | null>(null);
  const gameState = useSignal<GameState | null>(null);
  const loading = useSignal(true);
  const toastMsg = useSignal("");
  const toastType = useSignal("info");
  const transcriptOpen = useSignal(false);
  const remNotes = useSignal("");
  const remSubmitting = useSignal(false);
  const backfilling = useSignal(false);

  function showToast(msg: string, type = "info") {
    toastMsg.value = msg;
    toastType.value = type;
  }

  async function api(path: string, opts?: RequestInit) {
    const res = await fetch("/manager/api" + path, {
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  async function loadQueue() {
    loading.value = true;
    try {
      const [items, s] = await Promise.all([api("/queue"), api("/stats")]);
      queueData.value = items;
      stats.value = s;
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      loading.value = false;
    }
  }

  async function loadDetail(findingId: string) {
    screen.value = "detail";
    transcriptOpen.value = false;
    remNotes.value = "";
    try {
      const data = await api("/finding?id=" + encodeURIComponent(findingId));
      detail.value = data;
    } catch (err) {
      showToast((err as Error).message, "error");
      screen.value = "queue";
    }
  }

  async function loadGameState() {
    try {
      gameState.value = await api("/game-state");
    } catch { /* non-critical */ }
  }

  async function submitRemediation() {
    if (!detail.value || remNotes.value.trim().length < 20) return;
    remSubmitting.value = true;
    try {
      const result = await api("/remediate", {
        method: "POST",
        body: JSON.stringify({ findingId: detail.value.finding.id, notes: remNotes.value.trim() }),
      });
      showToast("Remediation submitted", "success");
      remNotes.value = "";
      await loadDetail(detail.value.finding.id);
      loadQueue();
      loadGameState();
      if (result.xpGained) {
        // XP flash handled by gameState refresh
      }
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      remSubmitting.value = false;
    }
  }

  async function backfill() {
    backfilling.value = true;
    try {
      const result = await api("/backfill", { method: "POST" });
      showToast("Backfilled " + (result.added || 0) + " items", "success");
      loadQueue();
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      backfilling.value = false;
    }
  }

  useEffect(() => {
    loadQueue();
    loadGameState();
  }, []);

  const filtered = useComputed(() => {
    const f = filterVal.value;
    const items = f === "all" ? queueData.value : queueData.value.filter((i) => i.status === f);
    return [...items].sort((a, b) => {
      if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
      return b.completedAt - a.completedAt;
    });
  });

  const xpProgress = useComputed(() => {
    const gs = gameState.value;
    if (!gs) return 0;
    const cur = LEVEL_THRESHOLDS[gs.level] || 0;
    const next = LEVEL_THRESHOLDS[gs.level + 1] || LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
    return next > cur ? Math.min(100, ((gs.totalXp - cur) / (next - cur)) * 100) : 100;
  });

  return (
    <div>
      <style>{`
        .stat-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 20px; }
        .stat-card { background: var(--bg-raised); border: 1px solid var(--border); border-radius: 12px; padding: 18px 20px; }
        .stat-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: var(--text-dim); margin-bottom: 6px; }
        .stat-value { font-size: 28px; font-weight: 700; color: var(--text-bright); font-variant-numeric: tabular-nums; }
        .stat-card.accent-purple .stat-value { color: var(--accent); }
        .stat-card.accent-blue .stat-value { color: var(--blue); }
        .stat-card.accent-cyan .stat-value { color: #79c0ff; }
        .stat-card.accent-yellow .stat-value { color: var(--yellow); }
        .toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
        .toolbar-left { display: flex; gap: 8px; align-items: center; }
        .filter-btn { padding: 5px 14px; border-radius: 8px; font-size: 12px; font-weight: 600; color: var(--text-muted); cursor: pointer; border: 1px solid var(--border); background: none; transition: all 0.15s; }
        .filter-btn:hover { background: var(--bg-raised); }
        .filter-btn.active { background: var(--accent-bg); color: var(--accent); border-color: rgba(139,92,246,0.3); }
        .backfill-btn { padding: 5px 14px; border-radius: 8px; font-size: 12px; font-weight: 600; color: var(--blue); cursor: pointer; border: 1px solid rgba(31,111,235,0.3); background: none; }
        .backfill-btn:hover { background: rgba(31,111,235,0.1); }
        .backfill-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .table-panel { background: var(--bg-raised); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--text-dim); padding: 12px 16px; border-bottom: 1px solid #1a1f2b; background: #0f1219; }
        td { font-size: 13px; padding: 12px 16px; border-bottom: 1px solid var(--bg-raised); color: #8b949e; }
        tr:last-child td { border-bottom: none; }
        tr:hover td { background: rgba(139,92,246,0.03); }
        .mono { font-family: var(--mono); font-size: 12px; color: var(--text); }
        .empty-cell { text-align: center; color: #3d4452; font-style: italic; padding: 40px; }
        .status-badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
        .status-badge::before { content: ''; width: 5px; height: 5px; border-radius: 50%; }
        .status-badge.pending { background: var(--yellow-bg); color: var(--yellow); }
        .status-badge.pending::before { background: var(--yellow); }
        .status-badge.addressed { background: var(--blue-bg); color: var(--blue); }
        .status-badge.addressed::before { background: var(--blue); }
        .fail-ratio { font-weight: 700; }
        .fail-ratio.bad { color: var(--yellow); }
        .fail-ratio.moderate { color: var(--accent); }
        .view-btn { padding: 4px 12px; border-radius: 6px; font-size: 11px; font-weight: 600; color: var(--blue); cursor: pointer; border: 1px solid rgba(31,111,235,0.3); background: none; }
        .view-btn:hover { background: rgba(31,111,235,0.1); }
        .detail-header { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; }
        .back-btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 8px; font-size: 12px; font-weight: 600; color: var(--text-muted); cursor: pointer; border: 1px solid var(--border); background: none; }
        .back-btn:hover { background: var(--bg-raised); }
        .detail-title { font-size: 18px; font-weight: 700; color: var(--text-bright); }
        .detail-meta { display: flex; gap: 8px; flex-wrap: wrap; margin-left: auto; }
        .meta-chip { display: inline-flex; align-items: center; gap: 4px; background: var(--bg-raised); border: 1px solid #1a1f2b; border-radius: 6px; padding: 4px 10px; font-size: 11px; color: var(--text-muted); }
        .meta-chip strong { color: var(--text); font-weight: 600; }
        .score-bar-wrap { margin-bottom: 20px; }
        .score-bar-label { font-size: 11px; color: var(--text-muted); margin-bottom: 6px; display: flex; justify-content: space-between; }
        .score-bar { height: 8px; background: #1a1f2b; border-radius: 4px; overflow: hidden; display: flex; }
        .score-bar .pass { background: var(--blue); }
        .score-bar .flip { background: var(--accent); }
        .score-bar .fail { background: var(--yellow); }
        .section-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
        .toggle-icon { cursor: pointer; font-size: 10px; color: var(--text-dim); transition: transform 0.2s; display: inline-block; }
        .toggle-icon.open { transform: rotate(90deg); }
        .q-cards { display: flex; flex-direction: column; gap: 12px; margin-bottom: 24px; }
        .q-card { background: var(--bg-raised); border: 1px solid var(--border); border-radius: 12px; padding: 18px 20px; }
        .q-card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
        .q-card-title { font-size: 15px; font-weight: 700; color: var(--text-bright); }
        .q-card-badge { font-size: 10px; font-weight: 700; padding: 3px 10px; border-radius: 20px; text-transform: uppercase; letter-spacing: 0.5px; }
        .q-card-badge.confirmed { background: var(--yellow-bg); color: var(--yellow); }
        .q-card-badge.flipped { background: var(--accent-bg); color: var(--accent); }
        .q-card-section { margin-bottom: 10px; }
        .q-card-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--blue); margin-bottom: 4px; }
        .q-card-text { font-size: 13px; line-height: 1.6; color: #b0b8c4; padding: 10px 14px; background: #0f1219; border-radius: 8px; border: 1px solid #1a1f2b; }
        .q-card-reviewer { font-size: 11px; color: var(--text-dim); margin-top: 6px; }
        .q-card-reviewer strong { color: var(--text-muted); }
        .q-card-snippet { font-size: 12px; line-height: 1.6; color: #8b949e; padding: 8px 12px; background: rgba(250,176,5,0.05); border-radius: 8px; border: 1px solid rgba(250,176,5,0.15); font-style: italic; }
        .transcript-section { margin-bottom: 24px; }
        .transcript-body { background: var(--bg-raised); border: 1px solid var(--border); border-radius: 12px; padding: 16px 20px; max-height: 500px; overflow-y: auto; }
        .t-line { font-size: 13px; line-height: 1.7; margin-bottom: 6px; padding: 4px 10px 4px 12px; border-left: 3px solid transparent; color: var(--text-muted); border-radius: 0 6px 6px 0; }
        .t-agent { border-left-color: #1f6feb; color: #79b8ff; }
        .t-customer { border-left-color: #8b5cf6; color: #d2b3ff; }
        .t-system { border-left-color: #2d333b; color: var(--text-dim); }
        .t-speaker { font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; margin-right: 8px; }
        .t-agent .t-speaker { color: #1f6feb; }
        .t-customer .t-speaker { color: #8b5cf6; }
        .record-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px; background: var(--bg-raised); border: 1px solid var(--border); border-radius: 12px; padding: 16px 20px; margin-bottom: 24px; }
        .record-field { font-size: 12px; }
        .rf-label { color: var(--text-dim); font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; }
        .rf-value { color: var(--text); margin-top: 2px; word-break: break-all; }
        .remediation-panel { background: var(--bg-raised); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
        .remediation-panel h3 { font-size: 14px; font-weight: 700; color: var(--text-bright); margin-bottom: 12px; }
        .remediation-panel textarea { width: 100%; height: 120px; padding: 12px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; color: var(--text); font-size: 14px; resize: vertical; font-family: inherit; }
        .remediation-panel textarea:focus { outline: none; border-color: var(--accent-dim); }
        .rem-footer { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; }
        .rem-counter { font-size: 11px; color: var(--text-dim); }
        .rem-counter.short { color: var(--red); }
        .rem-submit { padding: 9px 24px; background: linear-gradient(135deg, #1f6feb, #8b5cf6); border: none; border-radius: 10px; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer; }
        .rem-submit:disabled { opacity: 0.5; cursor: not-allowed; }
        .remediation-display { background: rgba(88,166,255,0.06); border: 1px solid rgba(88,166,255,0.2); border-radius: 12px; padding: 20px; }
        .remediation-display h3 { font-size: 14px; font-weight: 700; color: var(--blue); margin-bottom: 12px; }
        .rem-notes { font-size: 14px; line-height: 1.6; color: #b0b8c4; margin-bottom: 10px; white-space: pre-wrap; }
        .rem-meta { font-size: 11px; color: var(--text-dim); }
        .rem-meta strong { color: var(--text-muted); }
        .loading-wrap { display: flex; align-items: center; justify-content: center; padding: 60px; color: var(--text-dim); font-size: 13px; }
        .badge-showcase { display: flex; flex-wrap: wrap; gap: 10px; }
        .badge-item { display: flex; align-items: center; gap: 8px; padding: 8px 14px; background: #0f1219; border: 1px solid var(--border); border-radius: 10px; font-size: 12px; }
        .badge-item .bi-name { font-weight: 600; color: var(--text-bright); }
        .badge-item .bi-tier { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; margin-left: 4px; }
        .badge-item.locked { opacity: 0.35; }
        @media (max-width: 900px) { .stat-row { grid-template-columns: repeat(2, 1fr); } .detail-header { flex-wrap: wrap; } .detail-meta { margin-left: 0; } }
        @media (max-width: 600px) { .stat-row { grid-template-columns: 1fr; } }
      `}</style>

      {toastMsg.value && (
        <Toast msg={toastMsg.value} type={toastType.value} onDone={() => { toastMsg.value = ""; }} />
      )}

      {screen.value === "queue" && (
        <div>
          {stats.value && (
            <div class="stat-row">
              <div class="stat-card accent-purple">
                <div class="stat-label">Outstanding</div>
                <div class="stat-value">{fmt(stats.value.outstanding)}</div>
              </div>
              <div class="stat-card accent-blue">
                <div class="stat-label">Addressed This Week</div>
                <div class="stat-value">{fmt(stats.value.addressedThisWeek)}</div>
              </div>
              <div class="stat-card accent-cyan">
                <div class="stat-label">Total Audits</div>
                <div class="stat-value">{fmt(stats.value.total)}</div>
              </div>
              <div class="stat-card accent-yellow">
                <div class="stat-label">Avg Resolution</div>
                <div class="stat-value">{formatDuration(stats.value.avgResolutionMs)}</div>
              </div>
            </div>
          )}

          <div class="toolbar">
            <div class="toolbar-left">
              {(["all", "pending", "addressed"] as const).map((f) => (
                <button
                  key={f}
                  class={`filter-btn${filterVal.value === f ? " active" : ""}`}
                  onClick={() => { filterVal.value = f; }}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            <button class="backfill-btn" disabled={backfilling.value} onClick={backfill}>
              {backfilling.value ? "Backfilling..." : "Backfill Queue"}
            </button>
          </div>

          <div class="table-panel">
            {loading.value ? (
              <div class="loading-wrap">Loading queue...</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Record</th>
                    <th>Failed / Total</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.value.length === 0 ? (
                    <tr>
                      <td class="empty-cell" colSpan={6}>
                        No items{filterVal.value !== "all" ? " matching filter" : ""}
                      </td>
                    </tr>
                  ) : (
                    filtered.value.map((item) => {
                      const ratioClass = item.failedCount > item.totalQuestions / 2 ? "bad" : "moderate";
                      return (
                        <tr key={item.findingId}>
                          <td>{item.owner || "--"}</td>
                          <td class="mono">{item.recordId || item.findingId.slice(0, 12)}</td>
                          <td>
                            <span class={`fail-ratio ${ratioClass}`}>
                              {item.failedCount}/{item.totalQuestions}
                            </span>
                          </td>
                          <td style="color:var(--text-muted);font-size:12px">{formatDate(item.completedAt)}</td>
                          <td>
                            <span class={`status-badge ${item.status}`}>{item.status}</span>
                          </td>
                          <td>
                            <button class="view-btn" onClick={() => loadDetail(item.findingId)}>
                              View
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {screen.value === "detail" && detail.value && (
        <div>
          {(() => {
            const d = detail.value!;
            const f = d.finding;
            const qs = d.questions || [];
            const tx = d.transcript;
            const rem = d.remediation;
            const qi = d.queueItem;

            let passed = 0, failed = 0, flipped = 0;
            for (const q of qs) {
              if (q.answer === "No" && q.reviewDecision === "confirm") failed++;
              else if (q.answer === "No" && q.reviewDecision === "flip") flipped++;
              else passed++;
            }
            const total = qs.length || 1;
            const failedQs = qs.filter((q) => q.answer === "No");
            const transcriptLines = tx && (tx.diarized || tx.raw)
              ? (tx.diarized || tx.raw || "").split("\n").filter((l) => l.trim())
              : [];

            return (
              <>
                <div class="detail-header">
                  <button class="back-btn" onClick={() => { screen.value = "queue"; loadQueue(); }}>
                    &larr; Back
                  </button>
                  <span class="detail-title">Audit: {f.owner || "Unknown"}</span>
                  <div class="detail-meta">
                    <div class="meta-chip">Finding <strong>{f.id}</strong></div>
                    <div class="meta-chip">Recording <strong>{f.recordingId || "--"}</strong></div>
                    {f.recordId && <div class="meta-chip">Record <strong>{f.recordId}</strong></div>}
                  </div>
                </div>

                <div class="score-bar-wrap">
                  <div class="score-bar-label">
                    <span>{passed} passed{flipped > 0 ? `, ${flipped} flipped` : ""}</span>
                    <span>{failed} confirmed fail</span>
                  </div>
                  <div class="score-bar">
                    <div class="pass" style={{ width: `${(passed / total) * 100}%` }} />
                    <div class="flip" style={{ width: `${(flipped / total) * 100}%` }} />
                    <div class="fail" style={{ width: `${(failed / total) * 100}%` }} />
                  </div>
                </div>

                <div class="section-title">Failed Questions</div>
                <div class="q-cards">
                  {failedQs.length === 0 ? (
                    <div style="color:#3d4452;font-style:italic;padding:12px">No failed questions</div>
                  ) : (
                    failedQs.map((fq, i) => {
                      const isConfirmed = fq.reviewDecision === "confirm";
                      return (
                        <div class="q-card" key={i}>
                          <div class="q-card-head">
                            <span class="q-card-title">Q{fq.index}: {fq.header}</span>
                            <span class={`q-card-badge ${isConfirmed ? "confirmed" : "flipped"}`}>
                              {isConfirmed ? "Confirmed Fail" : "Flipped to Pass"}
                            </span>
                          </div>
                          {fq.defense && (
                            <div class="q-card-section">
                              <div class="q-card-label">Defense</div>
                              <div class="q-card-text">{fq.defense}</div>
                            </div>
                          )}
                          {fq.thinking && (
                            <div class="q-card-section">
                              <div class="q-card-label">Reasoning</div>
                              <div class="q-card-text" style="font-style:italic">{fq.thinking}</div>
                            </div>
                          )}
                          {fq.snippet && (
                            <div class="q-card-section">
                              <div class="q-card-label">Transcript Snippet</div>
                              <div class="q-card-snippet">{fq.snippet}</div>
                            </div>
                          )}
                          {fq.reviewer && (
                            <div class="q-card-reviewer">
                              Reviewed by <strong>{fq.reviewer}</strong>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                <div class="transcript-section">
                  <div class="section-title">
                    Transcript
                    <span
                      class={`toggle-icon${transcriptOpen.value ? " open" : ""}`}
                      onClick={() => { transcriptOpen.value = !transcriptOpen.value; }}
                    >
                      &#8250;
                    </span>
                  </div>
                  {transcriptOpen.value && (
                    <div class="transcript-body">
                      {transcriptLines.length === 0 ? (
                        <div style="color:#3d4452;font-style:italic;padding:12px">No transcript available</div>
                      ) : (
                        transcriptLines.map((line, i) => {
                          const m = line.match(/^\[?(AGENT|CUSTOMER|SYSTEM|Agent|Customer|System)\]?[:\s]*(.*)/i);
                          if (m) {
                            const speaker = m[1].toUpperCase() as "AGENT" | "CUSTOMER" | "SYSTEM";
                            const cls = speaker === "AGENT" ? "t-agent" : speaker === "CUSTOMER" ? "t-customer" : "t-system";
                            return (
                              <div class={`t-line ${cls}`} key={i}>
                                <span class="t-speaker">{speaker}</span>
                                {m[2] || ""}
                              </div>
                            );
                          }
                          return <div class="t-line" key={i}>{line}</div>;
                        })
                      )}
                    </div>
                  )}
                </div>

                {f.record && typeof f.record === "object" && (
                  <>
                    <div class="section-title">CRM Record</div>
                    <div class="record-grid">
                      {Object.entries(f.record).slice(0, 20)
                        .filter(([, v]) => v !== null && v !== undefined && v !== "")
                        .map(([k, v]) => (
                          <div class="record-field" key={k}>
                            <div class="rf-label">{k}</div>
                            <div class="rf-value">
                              {typeof v === "object" ? JSON.stringify(v) : String(v)}
                            </div>
                          </div>
                        ))}
                    </div>
                  </>
                )}

                {rem ? (
                  <div class="remediation-display">
                    <h3>Addressed</h3>
                    <div class="rem-notes">{rem.notes}</div>
                    <div class="rem-meta">
                      By <strong>{rem.addressedBy}</strong> on{" "}
                      {new Date(rem.addressedAt).toLocaleString()}
                    </div>
                  </div>
                ) : qi && qi.status === "pending" ? (
                  <div class="remediation-panel">
                    <h3>Remediation Notes</h3>
                    <textarea
                      value={remNotes.value}
                      placeholder="Describe the action taken to address these audit failures (min 20 characters)..."
                      onInput={(e) => { remNotes.value = (e.target as HTMLTextAreaElement).value; }}
                    />
                    <div class="rem-footer">
                      <span class={`rem-counter${remNotes.value.trim().length < 20 ? " short" : ""}`}>
                        {remNotes.value.trim().length} / 20 min
                      </span>
                      <button
                        class="rem-submit"
                        disabled={remNotes.value.trim().length < 20 || remSubmitting.value}
                        onClick={submitRemediation}
                      >
                        {remSubmitting.value ? "Submitting..." : "Submit Remediation"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            );
          })()}
        </div>
      )}

      {gameState.value && (
        <div style="position:fixed;bottom:60px;right:24px;display:flex;align-items:center;gap:8px;padding:8px 14px;background:var(--bg-raised);border:1px solid var(--border);border-radius:10px;">
          <span class="level-badge" style="font-size:11px;font-weight:800;color:var(--accent);background:var(--accent-bg);padding:3px 8px;border-radius:6px;">
            Lv.{gameState.value.level}
          </span>
          <div style="width:60px;height:6px;background:#1a1f2b;border-radius:3px;overflow:hidden;">
            <div style={{ width: `${xpProgress.value}%`, height: "100%", background: "linear-gradient(90deg,#8b5cf6,#bc8cff)", borderRadius: "3px" }} />
          </div>
        </div>
      )}
    </div>
  );
}
