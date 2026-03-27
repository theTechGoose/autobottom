import { useSignal, useComputed } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";

// ===== Types =====

interface ActiveAudit {
  findingId: string;
  step: string;
  ts: number;
}

interface ErrorEntry {
  findingId: string;
  step: string;
  error: string;
  ts: number;
}

interface TokensByFunction {
  [fn: string]: { total_tokens: number; calls: number };
}

interface DashboardData {
  pipeline: {
    inPipe: number;
    completed24h: number;
    errors24h: number;
    retries24h: number;
    active: ActiveAudit[];
    errors: ErrorEntry[];
    completedTs: number[];
    errorsTs: number[];
    retriesTs: number[];
  };
  review: {
    pending: number;
    decided: number;
  };
  tokens: {
    total_tokens: number;
    calls: number;
    by_function: TokensByFunction;
  };
}

interface User {
  username: string;
  role: string;
  supervisor?: string;
}

interface WebhookConfig {
  postUrl: string;
  postHeaders: Record<string, string>;
}

type WebhookKind = "terminate" | "appeal" | "manager" | "judge-finish";

interface SectionConfig {
  enabled: boolean;
  detail: "low" | "medium" | "high";
}

interface EmailReportConfig {
  id?: string;
  createdAt?: number;
  name: string;
  recipients: string[];
  cadence: "daily" | "weekly" | "biweekly" | "monthly";
  cadenceDay: number | null;
  sections: Record<string, SectionConfig>;
}

// ===== Helpers =====

function fmt(n: number | null | undefined): string {
  if (n == null) return "--";
  return Number(n).toLocaleString();
}

function timeAgo(ts: number | undefined): string {
  if (!ts) return "--";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function dur(ts: number | undefined): string {
  if (!ts) return "--";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

const ROLE_COLORS: Record<string, string> = {
  admin: "blue", judge: "purple", manager: "yellow", reviewer: "green", user: "cyan",
};
const ROLE_INITIALS: Record<string, string> = {
  admin: "A", judge: "J", manager: "M", reviewer: "R", user: "U",
};

const WH_DESCRIPTIONS: Record<WebhookKind, string> = {
  terminate: "Called when an audit is terminated (100% first pass or review completed)",
  appeal: "Called when an appeal is filed",
  manager: "Called when remediation is submitted",
  "judge-finish": "Called when a judge finishes all appeal decisions for an audit",
};

const SECTIONS = ["pipeline", "review", "appeals", "manager", "tokens"] as const;
const SECTION_LABELS: Record<string, string> = {
  pipeline: "Pipeline", review: "Review", appeals: "Appeals",
  manager: "Manager", tokens: "Tokens",
};
const CADENCES = ["daily", "weekly", "biweekly", "monthly"] as const;
const CADENCE_LABELS: Record<string, string> = {
  daily: "Daily", weekly: "Weekly", biweekly: "Biweekly", monthly: "Monthly",
};
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function defaultSections(): Record<string, SectionConfig> {
  const s: Record<string, SectionConfig> = {};
  for (const k of SECTIONS) s[k] = { enabled: true, detail: "medium" };
  return s;
}

// ===== Toast =====

interface ToastMsg {
  id: number;
  text: string;
  type: "success" | "error" | "info";
}

// ===== Chart helpers (canvas) =====

function bucketByHour(timestamps: number[]): number[] {
  const now = Date.now();
  const buckets = new Array(24).fill(0);
  for (const ts of timestamps) {
    const hoursAgo = Math.floor((now - ts) / 3_600_000);
    if (hoursAgo >= 0 && hoursAgo < 24) buckets[23 - hoursAgo]++;
  }
  return buckets;
}

function splinePath(ctx: CanvasRenderingContext2D, points: [number, number][]) {
  if (points.length < 2) return;
  ctx.moveTo(points[0][0], points[0][1]);
  if (points.length === 2) { ctx.lineTo(points[1][0], points[1][1]); return; }
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2[0], p2[1]);
  }
}

function drawActivityChart(
  canvas: HTMLCanvasElement,
  completedTs: number[],
  errorsTs: number[],
  retriesTs: number[],
) {
  const dpr = globalThis.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 140 * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  const W = rect.width, H = 140;

  const cB = bucketByHour(completedTs || []);
  const eB = bucketByHour(errorsTs || []);
  const rB = bucketByHour(retriesTs || []);

  let maxVal = 1;
  for (let i = 0; i < 24; i++) {
    if (cB[i] > maxVal) maxVal = cB[i];
    if (eB[i] > maxVal) maxVal = eB[i];
    if (rB[i] > maxVal) maxVal = rB[i];
  }
  maxVal = Math.ceil(maxVal * 1.15);

  const pad = { top: 20, bottom: 22, left: 32, right: 12 };
  const cW = W - pad.left - pad.right;
  const cH = H - pad.top - pad.bottom;

  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let g = 0; g <= 4; g++) {
    const gy = pad.top + cH - (g / 4) * cH;
    ctx.strokeStyle = "rgba(28,35,51,0.5)";
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(W - pad.right, gy); ctx.stroke();
    ctx.fillStyle = "#3d4452";
    ctx.font = "9px -apple-system, sans-serif";
    ctx.fillText(String(Math.round(maxVal * g / 4)), pad.left - 6, gy);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#3d4452";
  ctx.font = "9px -apple-system, sans-serif";
  const xlabels = ["24h", "", "", "20h", "", "", "16h", "", "", "12h", "", "", "8h", "", "", "4h", "", "", "", "", "", "", "", "now"];
  for (let i = 0; i < 24; i++) {
    if (xlabels[i]) {
      ctx.fillText(xlabels[i], pad.left + (i / 23) * cW, H - 12);
    }
  }

  const toPoints = (buckets: number[]): [number, number][] =>
    buckets.map((v, i) => [pad.left + (i / 23) * cW, pad.top + cH - (v / maxVal) * cH]);

  const series = [
    { buckets: cB, stroke: "rgba(63,185,80,0.9)", fill: "rgba(63,185,80,0.12)", label: "Completed", dotColor: "#3fb950" },
    { buckets: eB, stroke: "rgba(248,81,73,0.9)", fill: "rgba(248,81,73,0.08)", label: "Errors", dotColor: "#f85149" },
    { buckets: rB, stroke: "rgba(210,153,34,0.8)", fill: "rgba(210,153,34,0.06)", label: "Retries", dotColor: "#d29922" },
  ];

  for (const s of series) {
    const pts = toPoints(s.buckets);
    if (!s.buckets.some((v) => v > 0)) continue;

    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + cH);
    grad.addColorStop(0, s.fill);
    grad.addColorStop(1, "rgba(0,0,0,0)");

    ctx.beginPath();
    splinePath(ctx, pts);
    ctx.lineTo(pts[pts.length - 1][0], pad.top + cH);
    ctx.lineTo(pts[0][0], pad.top + cH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    splinePath(ctx, pts);
    ctx.strokeStyle = s.stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    for (let d = 0; d < pts.length; d++) {
      if (s.buckets[d] > 0) {
        ctx.beginPath();
        ctx.arc(pts[d][0], pts[d][1], 2.5, 0, Math.PI * 2);
        ctx.fillStyle = s.dotColor;
        ctx.fill();
      }
    }
  }

  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  let lx = W - pad.right;
  for (let j = series.length - 1; j >= 0; j--) {
    ctx.font = "9px -apple-system, sans-serif";
    const tw = ctx.measureText(series[j].label).width;
    ctx.fillStyle = "#6e7681";
    ctx.fillText(series[j].label, lx, 10);
    lx -= tw + 4;
    ctx.fillStyle = series[j].dotColor;
    ctx.beginPath();
    ctx.arc(lx, 10, 3, 0, Math.PI * 2);
    ctx.fill();
    lx -= 14;
  }
}

function drawDonut(canvas: HTMLCanvasElement, pending: number, decided: number) {
  const dpr = globalThis.devicePixelRatio || 1;
  canvas.width = 100 * dpr;
  canvas.height = 100 * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  const cx = 50, cy = 50, R = 40, r = 26;
  const total = (pending || 0) + (decided || 0);

  if (total === 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.arc(cx, cy, r, 0, Math.PI * 2, true);
    ctx.fillStyle = "rgba(28,35,51,0.5)";
    ctx.fill();
    ctx.fillStyle = "#484f58";
    ctx.font = "600 11px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("--", cx, cy);
  } else {
    const pAngle = (pending / total) * Math.PI * 2;
    const start = -Math.PI / 2;

    ctx.beginPath();
    ctx.arc(cx, cy, R, start + pAngle, start + Math.PI * 2);
    ctx.arc(cx, cy, r, start + Math.PI * 2, start + pAngle, true);
    ctx.closePath();
    ctx.fillStyle = "rgba(63,185,80,0.7)";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, R, start, start + pAngle);
    ctx.arc(cx, cy, r, start + pAngle, start, true);
    ctx.closePath();
    ctx.fillStyle = "rgba(210,153,34,0.7)";
    ctx.fill();

    const pct = Math.round((decided / total) * 100);
    ctx.fillStyle = "#e6edf3";
    ctx.font = "700 14px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${pct}%`, cx, cy);
  }
}

// ===== Main Island =====

export default function AdminDashboard() {
  const data = useSignal<DashboardData | null>(null);
  const statusDot = useSignal<"loading" | "ok" | "error">("loading");
  const countdown = useSignal(30);

  // Modals
  const modal = useSignal<"none" | "webhook" | "users" | "pipeline" | "devtools" | "email-reports">("none");

  // Toast
  const toasts = useSignal<ToastMsg[]>([]);
  let toastId = 0;

  function toast(text: string, type: ToastMsg["type"] = "info") {
    const id = ++toastId;
    toasts.value = [...toasts.value, { id, text, type }];
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id);
    }, 2400);
  }

  // Canvas refs
  const activityCanvasRef = useRef<HTMLCanvasElement>(null);
  const donutCanvasRef = useRef<HTMLCanvasElement>(null);

  // Timing refs (stored in useRef to avoid re-render loops)
  const lastDataRef = useRef<DashboardData | null>(null);
  const countdownRef = useRef(30);

  // ===== Fetch data =====
  async function fetchData() {
    statusDot.value = "loading";
    try {
      const res = await fetch("/admin/dashboard/data");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d: DashboardData = await res.json();
      data.value = d;
      lastDataRef.current = d;
      statusDot.value = "ok";
      renderCharts(d);
    } catch {
      statusDot.value = "error";
    }
  }

  function renderCharts(d: DashboardData) {
    if (activityCanvasRef.current) {
      drawActivityChart(
        activityCanvasRef.current,
        d.pipeline.completedTs || [],
        d.pipeline.errorsTs || [],
        d.pipeline.retriesTs || [],
      );
    }
    if (donutCanvasRef.current) {
      drawDonut(donutCanvasRef.current, d.review.pending || 0, d.review.decided || 0);
    }
  }

  useEffect(() => {
    fetchData();

    const tick = setInterval(() => {
      countdownRef.current -= 1;
      if (countdownRef.current <= 0) {
        fetchData();
        countdownRef.current = 30;
      }
      countdown.value = countdownRef.current;
    }, 1000);

    const resize = () => {
      if (lastDataRef.current) renderCharts(lastDataRef.current);
    };
    globalThis.addEventListener("resize", resize);

    return () => {
      clearInterval(tick);
      globalThis.removeEventListener("resize", resize);
    };
  }, []);

  // ===== Webhook Modal state =====
  const whKind = useSignal<WebhookKind>("terminate");
  const whPostUrl = useSignal("");
  const whHeaders = useSignal("");
  const whCache = useSignal<Partial<Record<WebhookKind, WebhookConfig>>>({});
  const whSaving = useSignal(false);

  async function loadWebhookTab(kind: WebhookKind) {
    whKind.value = kind;
    const cached = whCache.value[kind];
    if (cached) {
      whPostUrl.value = cached.postUrl || "";
      whHeaders.value = cached.postHeaders ? JSON.stringify(cached.postHeaders, null, 2) : "";
    } else {
      whPostUrl.value = "";
      whHeaders.value = "";
      try {
        const res = await fetch(`/admin/settings/${kind}`);
        const d: WebhookConfig = await res.json();
        whCache.value = { ...whCache.value, [kind]: d };
        if (whKind.value === kind) {
          whPostUrl.value = d.postUrl || "";
          whHeaders.value = d.postHeaders ? JSON.stringify(d.postHeaders, null, 2) : "";
        }
      } catch { /* ignore */ }
    }
  }

  async function saveWebhook() {
    const url = whPostUrl.value.trim();
    const raw = whHeaders.value.trim();
    let headers: Record<string, string> = {};
    if (raw) {
      try { headers = JSON.parse(raw); } catch { toast("Invalid JSON", "error"); return; }
    }
    whSaving.value = true;
    const saved: WebhookConfig = { postUrl: url, postHeaders: headers };
    try {
      const res = await fetch(`/admin/settings/${whKind.value}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(saved),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      whCache.value = { ...whCache.value, [whKind.value]: saved };
      toast(`${whKind.value} webhook saved`, "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      whSaving.value = false;
    }
  }

  // ===== Pipeline Modal state =====
  const pipeParallelism = useSignal("");
  const pipeRetries = useSignal("");
  const pipeRetryDelay = useSignal("");
  const pipeSaving = useSignal(false);

  async function loadPipelineData() {
    try {
      const [r1, r2] = await Promise.all([
        fetch("/admin/parallelism").then((r) => r.json()),
        fetch("/admin/pipeline-config").then((r) => r.json()),
      ]);
      pipeParallelism.value = r1.parallelism != null ? String(r1.parallelism) : "";
      pipeRetries.value = r2.maxRetries != null ? String(r2.maxRetries) : "";
      pipeRetryDelay.value = r2.retryDelaySeconds != null ? String(r2.retryDelaySeconds) : "";
    } catch { /* ignore */ }
  }

  async function savePipeline() {
    const par = parseInt(pipeParallelism.value);
    const mr = parseInt(pipeRetries.value);
    const rd = parseInt(pipeRetryDelay.value);
    if (isNaN(par) || par < 1) { toast("Parallelism must be >= 1", "error"); return; }
    if (isNaN(mr) || mr < 0) { toast("Retries must be >= 0", "error"); return; }
    if (isNaN(rd) || rd < 0) { toast("Delay must be >= 0", "error"); return; }
    pipeSaving.value = true;
    try {
      await Promise.all([
        fetch("/admin/parallelism", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parallelism: par }),
        }).then((r) => { if (!r.ok) throw new Error(`Parallelism: HTTP ${r.status}`); }),
        fetch("/admin/pipeline-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ maxRetries: mr, retryDelaySeconds: rd }),
        }).then((r) => { if (!r.ok) throw new Error(`Pipeline: HTTP ${r.status}`); }),
      ]);
      toast("Pipeline settings saved", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      pipeSaving.value = false;
    }
  }

  // ===== Users Modal state =====
  const allUsers = useSignal<User[]>([]);
  const usersTab = useSignal<"list" | "add">("list");
  const selectedRole = useSignal<string>("admin");
  const newEmail = useSignal("");
  const newPassword = useSignal("");
  const newSupervisor = useSignal("");
  const userSaving = useSignal(false);
  const currentAdminEmail = useSignal("");

  useEffect(() => {
    fetch("/admin/api/me")
      .then((r) => r.json())
      .then((d) => { currentAdminEmail.value = d.username || ""; })
      .catch(() => {});
  }, []);

  async function fetchUsers() {
    try {
      const d = await fetch("/admin/users").then((r) => r.json());
      allUsers.value = Array.isArray(d) ? d : [];
    } catch { allUsers.value = []; }
  }

  const supervisorOptions = useComputed(() => {
    const role = selectedRole.value;
    if (role === "admin") return [];
    const filterFn = (role === "judge" || role === "manager")
      ? (u: User) => u.role === "admin"
      : (u: User) => u.role === "judge" || u.role === "manager";
    return allUsers.value.filter(filterFn);
  });

  const needsSupervisor = useComputed(() => selectedRole.value !== "admin");

  async function createUser() {
    const u = newEmail.value.trim();
    const p = newPassword.value;
    if (!u || !p) { toast("Enter email & password", "error"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u)) { toast("Enter a valid email address", "error"); return; }
    const sup = newSupervisor.value;
    if (needsSupervisor.value && !sup) { toast("Select a supervisor", "error"); return; }
    userSaving.value = true;
    try {
      const res = await fetch("/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: u,
          password: p,
          role: selectedRole.value,
          supervisor: sup || null,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      toast(`${d.role} "${u}" created`, "success");
      newEmail.value = "";
      newPassword.value = "";
      await fetchUsers();
      usersTab.value = "list";
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      userSaving.value = false;
    }
  }

  // ===== Dev Tools =====
  const seedBusy = useSignal(false);
  const wipeBusy = useSignal(false);

  async function seedData() {
    seedBusy.value = true;
    try {
      const res = await fetch("/admin/seed", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      toast(`Seeded ${d.seeded} findings`, "success");
      await fetchData();
    } catch (e) {
      toast(`Seed failed: ${(e as Error).message}`, "error");
    } finally {
      seedBusy.value = false;
    }
  }

  async function wipeData() {
    if (!confirm("Wipe ALL KV data? Cannot be undone.")) return;
    wipeBusy.value = true;
    try {
      const res = await fetch("/admin/wipe-kv", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      toast(`Wiped ${d.deleted} entries`, "info");
      await fetchData();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      wipeBusy.value = false;
    }
  }

  // ===== Email Reports state =====
  const emailConfigs = useSignal<EmailReportConfig[]>([]);
  const erView = useSignal<"list" | "edit">("list");
  const erEditing = useSignal<EmailReportConfig | null>(null);
  const erSaving = useSignal(false);

  // Edit form fields
  const erName = useSignal("");
  const erRecipients = useSignal("");
  const erCadence = useSignal<string>("weekly");
  const erCadenceDay = useSignal<number | null>(1);
  const erSections = useSignal<Record<string, SectionConfig>>(defaultSections());

  async function loadEmailConfigs() {
    try {
      const d = await fetch("/admin/email-reports").then((r) => r.json());
      emailConfigs.value = Array.isArray(d) ? d : [];
    } catch { emailConfigs.value = []; }
  }

  function openEmailEdit(config?: EmailReportConfig) {
    const c = config || { name: "", recipients: [], cadence: "weekly", cadenceDay: 1, sections: defaultSections() };
    erEditing.value = config || null;
    erName.value = c.name;
    erRecipients.value = (c.recipients || []).join("\n");
    erCadence.value = c.cadence || "weekly";
    erCadenceDay.value = c.cadenceDay ?? 1;
    erSections.value = { ...defaultSections(), ...c.sections };
    erView.value = "edit";
  }

  async function deleteEmailConfig(id: string) {
    if (!confirm("Delete this report config?")) return;
    try {
      const res = await fetch("/admin/email-reports/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      emailConfigs.value = emailConfigs.value.filter((c) => c.id !== id);
      toast("Config deleted", "info");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function saveEmailConfig() {
    const name = erName.value.trim();
    if (!name) { toast("Name is required", "error"); return; }
    const recips = erRecipients.value.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!recips.length) { toast("At least one recipient required", "error"); return; }

    const payload: EmailReportConfig = {
      name,
      recipients: recips,
      cadence: erCadence.value as EmailReportConfig["cadence"],
      cadenceDay: erCadenceDay.value,
      sections: erSections.value,
    };
    const editing = erEditing.value;
    if (editing?.id) { payload.id = editing.id; payload.createdAt = editing.createdAt; }

    erSaving.value = true;
    try {
      const res = await fetch("/admin/email-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const saved: EmailReportConfig = await res.json();
      if (editing?.id) {
        emailConfigs.value = emailConfigs.value.map((c) => c.id === saved.id ? saved : c);
      } else {
        emailConfigs.value = [...emailConfigs.value, saved];
      }
      toast("Config saved", "success");
      erView.value = "list";
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      erSaving.value = false;
    }
  }

  // ===== Trigger audit =====
  async function triggerAudit(findingId: string) {
    try {
      const res = await fetch("/admin/trigger-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findingId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast(`Audit triggered for ${findingId}`, "success");
      await fetchData();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  // ===== Render =====

  const p = data.value?.pipeline;
  const r = data.value?.review;
  const t = data.value?.tokens;

  const sortedActiveAudits = p?.active?.slice() || [];
  const sortedErrors = (p?.errors?.slice() || [])
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .slice(0, 20);

  const dotClass = statusDot.value === "ok" ? "dot" : statusDot.value === "loading" ? "dot loading" : "dot error";

  function closeModal() {
    modal.value = "none";
  }

  const isLocal = typeof location !== "undefined" && new URLSearchParams(location.search).has("local");

  // Sorted users for list view
  const roleOrder = ["admin", "judge", "manager", "reviewer", "user"];
  const sortedUsers = allUsers.value.slice().sort(
    (a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role),
  );

  return (
    <>
      {/* Stat Cards */}
      <div class="stat-row">
        <div class="stat-card blue">
          <div class="stat-label">In Pipeline</div>
          <div class="stat-value">{fmt(p?.inPipe)}</div>
        </div>
        <div class="stat-card green">
          <div class="stat-label">Completed (24h)</div>
          <div class="stat-value">{fmt(p?.completed24h)}</div>
        </div>
        <div class="stat-card red">
          <div class="stat-label">Errors (24h)</div>
          <div class="stat-value">{fmt(p?.errors24h)}</div>
        </div>
        <div class="stat-card yellow">
          <div class="stat-label">Retries (24h)</div>
          <div class="stat-value">{fmt(p?.retries24h)}</div>
        </div>
      </div>

      {/* Charts */}
      <div class="charts">
        <div class="chart-panel">
          <div class="chart-title">Pipeline Activity (24h)</div>
          <div class="chart-wrap">
            <canvas ref={activityCanvasRef} id="chart-activity" height={140} style={{ width: "100%", height: "140px", display: "block" }} />
          </div>
        </div>
        <div class="chart-panel">
          <div class="chart-title">Review Progress</div>
          <div class="donut-wrap">
            <canvas ref={donutCanvasRef} class="donut-canvas" id="chart-donut" width={100} height={100} />
            <div class="donut-legend">
              <div class="donut-item">
                <span class="donut-dot" style={{ background: "var(--yellow)" }} />
                Pending
                <span class="donut-val">{fmt(r?.pending)}</span>
              </div>
              <div class="donut-item">
                <span class="donut-dot" style={{ background: "var(--green)" }} />
                Decided
                <span class="donut-val">{fmt(r?.decided)}</span>
              </div>
              <div class="donut-item" style={{ color: "var(--text-dim)", fontSize: "11px" }}>
                Total
                <span class="donut-val" style={{ color: "var(--text-muted)" }}>
                  {fmt((r?.pending || 0) + (r?.decided || 0))}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Panels */}
      <div class="panels">
        <div class="panel">
          <div class="panel-title">Review Queue</div>
          <div class="rq-row">
            <div class="rq-stat pending">
              <div class="rv">{fmt(r?.pending)}</div>
              <div class="rl">Pending</div>
            </div>
            <div class="rq-div" />
            <div class="rq-stat decided">
              <div class="rv">{fmt(r?.decided)}</div>
              <div class="rl">Decided</div>
            </div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-title">Token Usage (1h)</div>
          <div class="tk-total">
            {fmt(t?.total_tokens)} <small>tokens ({fmt(t?.calls)} calls)</small>
          </div>
          <div class="fn-list">
            {t?.by_function && Object.keys(t.by_function).length > 0
              ? Object.entries(t.by_function)
                .sort(([, a], [, b]) => b.total_tokens - a.total_tokens)
                .map(([fn, v]) => (
                  <div key={fn} class="fn-row">
                    <span class="fn-name">{fn}</span>
                    <span>
                      <span class="fn-tokens">{fmt(v.total_tokens)}</span>
                      <span class="fn-calls">{v.calls} calls</span>
                    </span>
                  </div>
                ))
              : (
                <div style={{ color: "var(--text-dim)", fontStyle: "italic", fontSize: "10px", padding: "4px" }}>
                  No usage this hour
                </div>
              )}
          </div>
        </div>
      </div>

      {/* Active Audits Table */}
      <div class="tbl">
        <div class="tbl-title">Active Audits</div>
        <table>
          <thead>
            <tr>
              <th>Finding ID</th>
              <th>Step</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {sortedActiveAudits.length === 0
              ? (
                <tr class="empty-row">
                  <td colspan={3}>No active audits</td>
                </tr>
              )
              : sortedActiveAudits.map((a) => (
                <tr key={a.findingId}>
                  <td class="mono">{a.findingId || "--"}</td>
                  <td><span class="step-badge">{a.step || "--"}</span></td>
                  <td class="duration">{dur(a.ts)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Recent Errors Table */}
      <div class="tbl">
        <div class="tbl-title">Recent Errors (24h)</div>
        <table>
          <thead>
            <tr>
              <th>Finding ID</th>
              <th>Step</th>
              <th>Error</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {sortedErrors.length === 0
              ? (
                <tr class="empty-row">
                  <td colspan={4}>No errors</td>
                </tr>
              )
              : sortedErrors.map((e, i) => (
                <tr key={i}>
                  <td class="mono">{e.findingId || "--"}</td>
                  <td><span class="step-badge">{e.step || "--"}</span></td>
                  <td class="error-msg" title={e.error || ""}>{e.error || "--"}</td>
                  <td class="time-ago">{timeAgo(e.ts)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Sidebar-style action buttons (admin actions at bottom of main) */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "8px", marginBottom: "16px" }}>
        <button
          class="btn ghost"
          onClick={() => { modal.value = "webhook"; loadWebhookTab(whKind.value); }}
        >
          Webhook
        </button>
        <button
          class="btn ghost"
          onClick={() => { modal.value = "email-reports"; loadEmailConfigs(); erView.value = "list"; }}
        >
          Email Reports
        </button>
        <button
          class="btn ghost"
          onClick={() => { modal.value = "users"; fetchUsers(); usersTab.value = "list"; }}
        >
          Users
        </button>
        <button
          class="btn ghost"
          onClick={() => { modal.value = "pipeline"; loadPipelineData(); }}
        >
          Pipeline
        </button>
        {isLocal && (
          <button class="btn ghost" onClick={() => { modal.value = "devtools"; }}>
            Dev Tools
          </button>
        )}
      </div>

      {/* ===== Webhook Modal ===== */}
      {modal.value === "webhook" && (
        <div class="modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div class="modal">
            <div class="modal-title">Webhook Configuration</div>
            <div class="wh-tabs" style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
              {(["terminate", "appeal", "manager", "judge-finish"] as WebhookKind[]).map((k) => (
                <button
                  key={k}
                  class={`wh-tab${whKind.value === k ? " active" : ""}`}
                  onClick={() => loadWebhookTab(k)}
                >
                  {k.charAt(0).toUpperCase() + k.slice(1)}
                </button>
              ))}
            </div>
            <div class="modal-sub">{WH_DESCRIPTIONS[whKind.value]}</div>
            <div class="sf">
              <label class="sf-label">POST URL</label>
              <input
                type="text"
                class="sf-input"
                placeholder="https://example.com/webhook"
                value={whPostUrl.value}
                onInput={(e) => { whPostUrl.value = (e.target as HTMLInputElement).value; }}
              />
            </div>
            <div class="sf">
              <label class="sf-label">Headers (JSON)</label>
              <textarea
                class="sf-input"
                placeholder='{"Authorization": "Bearer ..."}'
                value={whHeaders.value}
                onInput={(e) => { whHeaders.value = (e.target as HTMLTextAreaElement).value; }}
              />
            </div>
            <div class="modal-actions">
              <button class="sf-btn secondary" onClick={closeModal}>Cancel</button>
              <button class="sf-btn primary" onClick={saveWebhook} disabled={whSaving.value}>
                {whSaving.value ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Pipeline Modal ===== */}
      {modal.value === "pipeline" && (
        <div class="modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div class="modal pipeline-modal">
            <div class="pm-header">
              <div class="pm-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="3" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14" />
                </svg>
              </div>
              <div>
                <div class="modal-title">Pipeline Settings</div>
                <div class="modal-sub">Control concurrency and failure recovery</div>
              </div>
            </div>

            <div class="pm-section">
              <div class="pm-section-label">Concurrency</div>
              <div class="pm-field">
                <div class="pm-field-info">
                  <div class="pm-field-name">Parallelism</div>
                  <div class="pm-field-desc">Max concurrent audit operations</div>
                </div>
                <div class="pm-stepper">
                  <button
                    class="pm-step-btn"
                    type="button"
                    onClick={() => { const v = parseInt(pipeParallelism.value) || 1; pipeParallelism.value = String(Math.max(1, v - 1)); }}
                  >
                    &minus;
                  </button>
                  <input
                    type="number"
                    class="pm-step-value"
                    min={1}
                    max={100}
                    placeholder="--"
                    value={pipeParallelism.value}
                    onInput={(e) => { pipeParallelism.value = (e.target as HTMLInputElement).value; }}
                  />
                  <button
                    class="pm-step-btn"
                    type="button"
                    onClick={() => { const v = parseInt(pipeParallelism.value) || 0; pipeParallelism.value = String(Math.min(100, v + 1)); }}
                  >
                    +
                  </button>
                  <span class="pm-unit" style={{ visibility: "hidden" }}>sec</span>
                </div>
              </div>
            </div>

            <div class="pm-divider" />

            <div class="pm-section">
              <div class="pm-section-label">Retry Policy</div>
              <div class="pm-field">
                <div class="pm-field-info">
                  <div class="pm-field-name">Max Retries</div>
                  <div class="pm-field-desc">Attempts before marking failed</div>
                </div>
                <div class="pm-stepper">
                  <button
                    class="pm-step-btn"
                    type="button"
                    onClick={() => { const v = parseInt(pipeRetries.value) || 0; pipeRetries.value = String(Math.max(0, v - 1)); }}
                  >
                    &minus;
                  </button>
                  <input
                    type="number"
                    class="pm-step-value"
                    min={0}
                    max={50}
                    placeholder="--"
                    value={pipeRetries.value}
                    onInput={(e) => { pipeRetries.value = (e.target as HTMLInputElement).value; }}
                  />
                  <button
                    class="pm-step-btn"
                    type="button"
                    onClick={() => { const v = parseInt(pipeRetries.value) || 0; pipeRetries.value = String(Math.min(50, v + 1)); }}
                  >
                    +
                  </button>
                  <span class="pm-unit" style={{ visibility: "hidden" }}>sec</span>
                </div>
              </div>
              <div class="pm-field">
                <div class="pm-field-info">
                  <div class="pm-field-name">Delay</div>
                  <div class="pm-field-desc">Seconds between retry attempts</div>
                </div>
                <div class="pm-stepper">
                  <button
                    class="pm-step-btn"
                    type="button"
                    onClick={() => { const v = parseInt(pipeRetryDelay.value) || 0; pipeRetryDelay.value = String(Math.max(0, v - 1)); }}
                  >
                    &minus;
                  </button>
                  <input
                    type="number"
                    class="pm-step-value"
                    min={0}
                    max={300}
                    placeholder="--"
                    value={pipeRetryDelay.value}
                    onInput={(e) => { pipeRetryDelay.value = (e.target as HTMLInputElement).value; }}
                  />
                  <button
                    class="pm-step-btn"
                    type="button"
                    onClick={() => { const v = parseInt(pipeRetryDelay.value) || 0; pipeRetryDelay.value = String(Math.min(300, v + 1)); }}
                  >
                    +
                  </button>
                  <span class="pm-unit">sec</span>
                </div>
              </div>
            </div>

            <div class="modal-actions">
              <button class="sf-btn secondary" onClick={closeModal}>Cancel</button>
              <button class="sf-btn primary" onClick={savePipeline} disabled={pipeSaving.value}>
                {pipeSaving.value ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Users Modal ===== */}
      {modal.value === "users" && (
        <div class="modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div class="modal" style={{ width: "560px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
              <div class="modal-title" style={{ marginBottom: 0 }}>Team</div>
              <div style={{ display: "flex", gap: "4px" }}>
                <button
                  class={`sf-btn ghost um-tab${usersTab.value === "list" ? " active" : ""}`}
                  style={{ fontSize: "10px", padding: "4px 10px" }}
                  onClick={() => { usersTab.value = "list"; }}
                >
                  Members
                </button>
                <button
                  class={`sf-btn ghost um-tab${usersTab.value === "add" ? " active" : ""}`}
                  style={{ fontSize: "10px", padding: "4px 10px" }}
                  onClick={() => { usersTab.value = "add"; }}
                >
                  + Add
                </button>
              </div>
            </div>
            <div class="modal-sub">Manage your organization's users and roles</div>

            {usersTab.value === "list" && (
              <div style={{ maxHeight: "340px", overflowY: "auto", marginBottom: "12px" }}>
                {sortedUsers.length === 0
                  ? (
                    <div class="um-empty">
                      <div class="um-empty-icon" style={{ fontSize: "24px", marginBottom: "8px", opacity: "0.3" }}>
                        --
                      </div>
                      <div class="um-empty-text">No users yet. Click "+ Add" to create one.</div>
                    </div>
                  )
                  : sortedUsers.map((u) => {
                    const c = ROLE_COLORS[u.role] || "blue";
                    return (
                      <div key={u.username} class="um-user-row">
                        <div
                          class="um-user-avatar"
                          style={{
                            background: `var(--${c}-bg)`,
                            color: `var(--${c})`,
                          }}
                        >
                          {ROLE_INITIALS[u.role] || "?"}
                        </div>
                        <div class="um-user-info">
                          <div class="um-user-email">{u.username}</div>
                          <div class="um-user-meta">
                            {u.supervisor ? `reports to ${u.supervisor}` : "no supervisor"}
                          </div>
                        </div>
                        <span class={`um-badge ${u.role}`}>
                          {u.role === "user" ? "agent" : u.role}
                        </span>
                      </div>
                    );
                  })}
              </div>
            )}

            {usersTab.value === "add" && (
              <div>
                <div class="modal-group">
                  <div class="modal-group-title">1. Choose Role</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                    {(["admin", "judge", "manager", "reviewer", "user"] as const).map((role) => {
                      const colors: Record<string, [string, string]> = {
                        admin: ["blue-bg", "blue"],
                        judge: ["purple-bg", "purple"],
                        manager: ["yellow-bg", "yellow"],
                        reviewer: ["green-bg", "green"],
                        user: ["cyan-bg", "cyan"],
                      };
                      const [bg, fg] = colors[role];
                      const descs: Record<string, string> = {
                        admin: "Full access. Manages judges & managers.",
                        judge: "Reviews appeals. Owns reviewers.",
                        manager: "Remediates failures. Owns reviewers.",
                        reviewer: "Verifies audit findings.",
                        user: "Call center agent. Scoped to manager.",
                      };
                      const names: Record<string, string> = {
                        admin: "Admin", judge: "Judge", manager: "Manager",
                        reviewer: "Reviewer", user: "Agent",
                      };
                      return (
                        <button
                          key={role}
                          class={`um-role${selectedRole.value === role ? " active" : ""}`}
                          onClick={() => { selectedRole.value = role; newSupervisor.value = ""; }}
                        >
                          <span class="um-role-icon" style={{ background: `var(--${bg})`, color: `var(--${fg})` }}>
                            {names[role][0]}
                          </span>
                          <span class="um-role-info">
                            <span class="um-role-name">{names[role]}</span>
                            <span class="um-role-desc">{descs[role]}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {needsSupervisor.value && (
                  <div class="modal-group">
                    <div class="modal-group-title">
                      2. Assign To{" "}
                      <span style={{ color: "var(--blue)" }}>
                        {selectedRole.value === "judge" || selectedRole.value === "manager"
                          ? "an Admin"
                          : "a Judge or Manager"}
                      </span>
                    </div>
                    <select
                      class="sf-input"
                      style={{ width: "100%" }}
                      value={newSupervisor.value}
                      onChange={(e) => { newSupervisor.value = (e.target as HTMLSelectElement).value; }}
                    >
                      <option value="">-- Select --</option>
                      {supervisorOptions.value.map((u) => (
                        <option key={u.username} value={u.username}>
                          {u.username === currentAdminEmail.value ? `Self (${u.username})` : u.username}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div class="modal-group">
                  <div class="modal-group-title">
                    {needsSupervisor.value ? "3" : "2"}. Credentials
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <div class="sf">
                      <label class="sf-label">Email</label>
                      <input
                        type="email"
                        class="sf-input"
                        placeholder="jsmith@example.com"
                        value={newEmail.value}
                        onInput={(e) => { newEmail.value = (e.target as HTMLInputElement).value; }}
                      />
                    </div>
                    <div class="sf">
                      <label class="sf-label">Password</label>
                      <input
                        type="password"
                        class="sf-input"
                        placeholder="••••••••"
                        value={newPassword.value}
                        onInput={(e) => { newPassword.value = (e.target as HTMLInputElement).value; }}
                      />
                    </div>
                  </div>
                </div>

                <button
                  class="sf-btn primary"
                  style={{ width: "100%", padding: "10px", fontSize: "12px", borderRadius: "8px" }}
                  onClick={createUser}
                  disabled={userSaving.value}
                >
                  {userSaving.value
                    ? "Creating..."
                    : `Create ${selectedRole.value === "user" ? "Agent" : selectedRole.value.charAt(0).toUpperCase() + selectedRole.value.slice(1)}`}
                </button>
              </div>
            )}

            <div class="modal-actions" style={{ marginTop: "12px" }}>
              <button class="sf-btn secondary" onClick={closeModal}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Dev Tools Modal ===== */}
      {modal.value === "devtools" && (
        <div class="modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div class="modal">
            <div class="modal-title">Dev Tools</div>
            <div class="modal-sub">Local development utilities</div>
            <div class="dt-action seed">
              <div class="dt-icon" style={{ background: "var(--blue-bg)", color: "var(--blue)" }}>DB</div>
              <div class="dt-info">
                <div class="dt-name">Seed Test Data</div>
                <div class="dt-desc">Populate KV with sample findings for testing</div>
              </div>
              <button class="sf-btn primary" onClick={seedData} disabled={seedBusy.value}>
                {seedBusy.value ? "Seeding..." : "Seed"}
              </button>
            </div>
            <div class="dt-action wipe">
              <div class="dt-icon" style={{ background: "var(--red-bg)", color: "var(--red)" }}>!</div>
              <div class="dt-info">
                <div class="dt-name">Wipe All KV Data</div>
                <div class="dt-desc">Permanently delete every entry -- cannot be undone</div>
              </div>
              <button class="sf-btn danger" onClick={wipeData} disabled={wipeBusy.value}>
                {wipeBusy.value ? "Wiping..." : "Wipe"}
              </button>
            </div>
            <div class="modal-actions">
              <button class="sf-btn secondary" onClick={closeModal}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Email Reports Modal ===== */}
      {modal.value === "email-reports" && (
        <div class="modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div class="modal er-modal">
            {erView.value === "list" && (
              <>
                <div class="er-header">
                  <div class="modal-title">Email Report Configs</div>
                  <button class="sf-btn primary" onClick={() => openEmailEdit()}>+ New</button>
                </div>
                {emailConfigs.value.length === 0
                  ? <div class="er-empty">No report configs yet</div>
                  : (
                    <table class="er-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Cadence</th>
                          <th>Recipients</th>
                          <th>Sections</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {emailConfigs.value.map((c) => {
                          const enabledCount = SECTIONS.filter((k) => c.sections[k]?.enabled).length;
                          let cadenceLabel = CADENCE_LABELS[c.cadence] || "Weekly";
                          if (c.cadenceDay != null && c.cadence !== "daily") {
                            if (c.cadence === "monthly") {
                              cadenceLabel += ` (day ${c.cadenceDay})`;
                            } else {
                              cadenceLabel += ` (${WEEKDAYS[c.cadenceDay]})`;
                            }
                          }
                          return (
                            <tr key={c.id} style={{ cursor: "pointer" }}>
                              <td onClick={() => openEmailEdit(c)}>{c.name}</td>
                              <td onClick={() => openEmailEdit(c)}>{cadenceLabel}</td>
                              <td onClick={() => openEmailEdit(c)}>{c.recipients.length}</td>
                              <td onClick={() => openEmailEdit(c)}>{enabledCount}/{SECTIONS.length}</td>
                              <td>
                                <button
                                  class="er-trash"
                                  onClick={(e) => { e.stopPropagation(); if (c.id) deleteEmailConfig(c.id); }}
                                >
                                  x
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
              </>
            )}

            {erView.value === "edit" && (
              <>
                <div class="er-header">
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <button class="er-back" onClick={() => { erView.value = "list"; }}>
                      &larr;
                    </button>
                    <div class="modal-title">
                      {erEditing.value ? "Edit Report Config" : "New Report Config"}
                    </div>
                  </div>
                </div>

                <div class="sf">
                  <label class="sf-label">Name</label>
                  <input
                    type="text"
                    class="sf-input"
                    placeholder="Weekly Executive Summary"
                    value={erName.value}
                    onInput={(e) => { erName.value = (e.target as HTMLInputElement).value; }}
                  />
                </div>
                <div class="sf">
                  <label class="sf-label">Recipients (one per line)</label>
                  <textarea
                    class="sf-input"
                    placeholder="ceo@example.com"
                    value={erRecipients.value}
                    onInput={(e) => { erRecipients.value = (e.target as HTMLTextAreaElement).value; }}
                  />
                </div>

                <div class="sf">
                  <label class="sf-label">Cadence</label>
                  <div class="er-cadence">
                    {CADENCES.map((c) => (
                      <button
                        key={c}
                        class={`er-cadence-pill${erCadence.value === c ? " active" : ""}`}
                        onClick={() => { erCadence.value = c; erCadenceDay.value = c === "daily" ? null : 1; }}
                      >
                        {CADENCE_LABELS[c]}
                      </button>
                    ))}
                  </div>
                  {erCadence.value !== "daily" && (
                    <div class="er-cadence-day" style={{ marginTop: "8px" }}>
                      <span class="er-cadence-day-label">
                        {erCadence.value === "monthly" ? "Day of month" : "Day of week"}
                      </span>
                      {erCadence.value === "monthly"
                        ? (
                          <input
                            type="number"
                            class="er-day-input"
                            min={1}
                            max={30}
                            value={erCadenceDay.value ?? 1}
                            onInput={(e) => {
                              const v = parseInt((e.target as HTMLInputElement).value);
                              erCadenceDay.value = isNaN(v) ? 1 : Math.max(1, Math.min(30, v));
                            }}
                          />
                        )
                        : WEEKDAYS.map((day, i) => (
                          <button
                            key={i}
                            class={`er-day-pill${erCadenceDay.value === i ? " active" : ""}`}
                            onClick={() => { erCadenceDay.value = i; }}
                          >
                            {day}
                          </button>
                        ))}
                    </div>
                  )}
                </div>

                <div class="sf">
                  <label class="sf-label">Sections</label>
                  <table class="er-sections-table">
                    <tbody>
                      {SECTIONS.map((key) => {
                        const sc = erSections.value[key] || { enabled: true, detail: "medium" };
                        return (
                          <tr key={key}>
                            <td class="er-section-check">
                              <input
                                type="checkbox"
                                checked={sc.enabled}
                                onChange={(e) => {
                                  erSections.value = {
                                    ...erSections.value,
                                    [key]: { ...sc, enabled: (e.target as HTMLInputElement).checked },
                                  };
                                }}
                              />
                            </td>
                            <td class="er-section-name">{SECTION_LABELS[key]}</td>
                            <td>
                              <div class="er-pills">
                                {(["low", "medium", "high"] as const).map((level) => (
                                  <button
                                    key={level}
                                    class={`er-pill${sc.detail === level ? " active" : ""}${!sc.enabled ? " disabled" : ""}`}
                                    onClick={() => {
                                      if (!sc.enabled) return;
                                      erSections.value = {
                                        ...erSections.value,
                                        [key]: { ...sc, detail: level },
                                      };
                                    }}
                                  >
                                    {level === "low" ? "Low" : level === "medium" ? "Med" : "High"}
                                  </button>
                                ))}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div class="modal-actions">
                  <button class="sf-btn secondary" onClick={closeModal}>Cancel</button>
                  <button class="sf-btn primary" onClick={saveEmailConfig} disabled={erSaving.value}>
                    {erSaving.value ? "Saving..." : "Save"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Toast container */}
      <div class="t-wrap" style={{ position: "fixed", bottom: "20px", left: "50%", transform: "translateX(-50%)", zIndex: 200, display: "flex", flexDirection: "column-reverse", gap: "6px", alignItems: "center", pointerEvents: "none" }}>
        {toasts.value.map((t) => (
          <div key={t.id} class={`t-toast ${t.type}`}>
            <span class="t-dot" />
            {t.text}
          </div>
        ))}
      </div>

      {/* Inline styles for classes not in shared CSS */}
      <style>{`
        .stat-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
        .stat-card { background: var(--bg-raised); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; transition: border-color 0.15s; }
        .stat-card:hover { border-color: var(--border-hover); }
        .stat-card .stat-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: var(--text-dim); margin-bottom: 3px; }
        .stat-card .stat-value { font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums; }
        .stat-card.blue .stat-value { color: var(--blue); }
        .stat-card.green .stat-value { color: var(--green); }
        .stat-card.red .stat-value { color: var(--red); }
        .stat-card.yellow .stat-value { color: var(--yellow); }

        .charts { display: grid; grid-template-columns: 2fr 1fr; gap: 10px; margin-bottom: 16px; }
        .chart-panel { background: var(--bg-raised); border: 1px solid var(--border); border-radius: 10px; padding: 16px 16px 12px; }
        .chart-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--text-dim); margin-bottom: 10px; }
        .chart-wrap { position: relative; }

        .donut-wrap { display: flex; align-items: center; gap: 20px; padding: 8px 0; }
        .donut-canvas { width: 100px; height: 100px; }
        .donut-legend { display: flex; flex-direction: column; gap: 8px; }
        .donut-item { display: flex; align-items: center; gap: 8px; font-size: 12px; }
        .donut-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .donut-val { font-weight: 700; color: var(--text-bright); font-variant-numeric: tabular-nums; margin-left: auto; }

        .panels { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
        .panel { background: var(--bg-raised); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
        .panel-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--text-dim); margin-bottom: 10px; }

        .rq-row { display: flex; gap: 20px; align-items: center; }
        .rq-stat { text-align: center; }
        .rq-stat .rv { font-size: 24px; font-weight: 700; font-variant-numeric: tabular-nums; }
        .rq-stat .rl { font-size: 9px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.8px; margin-top: 2px; }
        .rq-stat.pending .rv { color: var(--yellow); }
        .rq-stat.decided .rv { color: var(--green); }
        .rq-div { width: 1px; height: 32px; background: var(--border); }

        .tk-total { font-size: 16px; font-weight: 700; color: var(--text-bright); margin-bottom: 8px; font-variant-numeric: tabular-nums; }
        .tk-total small { font-size: 10px; color: var(--text-dim); font-weight: 400; }
        .fn-list { display: flex; flex-direction: column; gap: 3px; max-height: 120px; overflow-y: auto; }
        .fn-row { display: flex; justify-content: space-between; align-items: center; padding: 3px 7px; background: var(--bg); border-radius: 4px; font-size: 10px; }
        .fn-name { color: var(--text-muted); font-family: var(--mono); }
        .fn-tokens { color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; }
        .fn-calls { color: var(--text-dim); font-size: 9px; margin-left: 5px; }

        .tbl { background: var(--bg-raised); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; }
        .tbl-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--text-dim); margin-bottom: 8px; }
        .mono { font-family: var(--mono); font-size: 10px; color: var(--text); }
        .step-badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; background: var(--blue-bg); color: var(--blue); }
        .error-msg { color: var(--red); font-size: 10px; max-width: 350px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .time-ago { color: var(--text-dim); font-size: 10px; font-variant-numeric: tabular-nums; }
        .duration { color: var(--yellow); font-variant-numeric: tabular-nums; }
        .empty-row td { text-align: center; color: var(--text-dim); font-style: italic; padding: 14px; font-size: 11px; }

        /* Modal */
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); backdrop-filter: blur(8px); z-index: 100; display: none; align-items: center; justify-content: center; }
        .modal-overlay.open { display: flex; }
        .modal { background: var(--bg-raised); border: 1px solid var(--border); border-radius: 16px; width: 500px; max-width: 92vw; padding: 28px 32px 24px; animation: modalIn 0.18s ease; box-shadow: 0 16px 48px rgba(0,0,0,0.4); }
        @keyframes modalIn { from { opacity: 0; transform: scale(0.96) translateY(8px); } to { opacity: 1; transform: none; } }
        .modal-title { font-size: 17px; font-weight: 700; color: var(--text-bright); margin-bottom: 4px; }
        .modal-sub { font-size: 12px; color: var(--text-dim); margin-bottom: 20px; line-height: 1.4; }
        .modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--border); }
        .modal-actions .sf-btn { padding: 10px 24px; font-size: 13px; border-radius: 8px; }

        /* Sidebar form buttons */
        .sf { margin-bottom: 8px; }
        .sf-label { display: block; font-size: 9px; color: var(--text-muted); margin-bottom: 3px; text-transform: uppercase; letter-spacing: 0.8px; font-weight: 600; }
        .sf-input { width: 100%; padding: 6px 9px; background: var(--bg-raised); border: 1px solid var(--border); border-radius: 5px; color: var(--text); font-size: 11px; font-family: var(--mono); transition: border-color 0.15s; }
        .sf-input:focus { outline: none; border-color: var(--blue); }
        textarea.sf-input { height: 48px; resize: vertical; }
        .sf-btn { display: inline-flex; align-items: center; justify-content: center; padding: 5px 12px; border: none; border-radius: 5px; font-size: 10px; font-weight: 600; cursor: pointer; transition: all 0.15s; }
        .sf-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .sf-btn.primary { background: var(--blue); color: #fff; }
        .sf-btn.primary:hover:not(:disabled) { background: #388bfd; }
        .sf-btn.secondary { background: transparent; color: var(--text-muted); border: 1px solid var(--border); }
        .sf-btn.secondary:hover { background: var(--bg-surface); }
        .sf-btn.ghost { background: transparent; color: var(--text-muted); border: 1px solid var(--border); }
        .sf-btn.ghost:hover:not(:disabled) { background: var(--bg-surface); }
        .sf-btn.danger { background: transparent; color: var(--red); border: 1px solid rgba(248,81,73,0.2); }
        .sf-btn.danger:hover:not(:disabled) { background: var(--red-bg); }

        /* Modal groups */
        .modal-group { margin-bottom: 16px; }
        .modal-group-title { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: var(--text-dim); margin-bottom: 10px; }

        /* Webhook tabs */
        .wh-tab { padding: 7px 16px; border: 1px solid var(--border); border-radius: 20px; background: transparent; color: var(--text-dim); font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s; }
        .wh-tab:hover { border-color: var(--border-hover); color: var(--text); background: var(--bg-surface); }
        .wh-tab.active { background: var(--blue-bg); border-color: rgba(88,166,255,0.35); color: var(--blue); }

        /* Pipeline modal */
        .pipeline-modal { width: 480px; padding: 0; overflow: hidden; }
        .pm-header { display: flex; align-items: center; gap: 14px; padding: 24px 28px 20px; }
        .pm-icon { width: 40px; height: 40px; border-radius: 10px; background: var(--yellow-bg); color: var(--yellow); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .pm-section { padding: 0 28px; }
        .pm-section-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: var(--text-dim); margin-bottom: 14px; }
        .pm-divider { height: 1px; background: var(--border); margin: 20px 28px; }
        .pm-field { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; margin-bottom: 10px; transition: border-color 0.15s; }
        .pm-field:hover { border-color: var(--border-hover); }
        .pm-field-info { flex: 1; min-width: 0; }
        .pm-field-name { font-size: 13px; font-weight: 600; color: var(--text-bright); margin-bottom: 2px; }
        .pm-field-desc { font-size: 11px; color: var(--text-muted); }
        .pm-stepper { display: flex; align-items: center; gap: 0; flex-shrink: 0; margin-left: 16px; }
        .pm-step-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border); background: var(--bg-raised); color: var(--text-muted); font-size: 16px; cursor: pointer; transition: all 0.12s; line-height: 1; user-select: none; }
        .pm-step-btn:first-child { border-radius: 8px 0 0 8px; border-right: none; }
        .pm-step-btn:last-of-type { border-radius: 0 8px 8px 0; border-left: none; }
        .pm-step-btn:hover { background: var(--bg-surface); color: var(--text-bright); border-color: var(--border-hover); }
        .pm-step-value { width: 52px; height: 32px; text-align: center; border: 1px solid var(--border); background: var(--bg-surface); color: var(--text-bright); font-size: 14px; font-weight: 700; font-family: var(--mono); -moz-appearance: textfield; }
        .pm-step-value:focus { outline: none; border-color: var(--blue); }
        .pm-unit { font-size: 11px; color: var(--text-muted); margin-left: 8px; font-weight: 500; }
        .pipeline-modal .modal-actions { padding: 16px 28px 24px; margin-top: 20px; border-top: 1px solid var(--border); }

        /* Users modal */
        .um-tab.active { background: var(--bg-surface); color: var(--text-bright); border-color: var(--border-hover); }
        .um-role { display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; cursor: pointer; transition: all 0.12s; text-align: left; color: var(--text); }
        .um-role:hover { border-color: var(--border-hover); background: var(--bg-surface); }
        .um-role.active { border-color: rgba(88,166,255,0.4); background: var(--blue-bg); }
        .um-role-icon { width: 32px; height: 32px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; font-weight: 700; }
        .um-role-info { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
        .um-role-name { font-size: 11px; font-weight: 700; color: var(--text-bright); }
        .um-role-desc { font-size: 9px; color: var(--text-dim); line-height: 1.3; }
        .um-user-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 6px; transition: background 0.1s; }
        .um-user-row:hover { background: var(--bg-surface); }
        .um-user-row + .um-user-row { border-top: 1px solid var(--border); }
        .um-user-avatar { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; flex-shrink: 0; }
        .um-user-info { flex: 1; min-width: 0; }
        .um-user-email { font-size: 11px; font-weight: 600; color: var(--text-bright); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .um-user-meta { font-size: 9px; color: var(--text-dim); }
        .um-badge { font-size: 9px; font-weight: 600; padding: 2px 8px; border-radius: 10px; text-transform: uppercase; letter-spacing: 0.5px; flex-shrink: 0; }
        .um-badge.admin { background: var(--blue-bg); color: var(--blue); }
        .um-badge.judge { background: var(--purple-bg); color: var(--purple); }
        .um-badge.manager { background: var(--yellow-bg); color: var(--yellow); }
        .um-badge.reviewer { background: var(--green-bg); color: var(--green); }
        .um-badge.user { background: var(--cyan-bg); color: var(--cyan); }
        .um-empty { text-align: center; padding: 32px 16px; }
        .um-empty-text { font-size: 11px; color: var(--text-dim); }

        /* Dev tools */
        .dt-action { padding: 16px; border: 1px solid var(--border); border-radius: 10px; margin-bottom: 10px; display: flex; align-items: center; gap: 14px; transition: border-color 0.15s; }
        .dt-action:hover { border-color: var(--border-hover); }
        .dt-action .dt-icon { width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 700; flex-shrink: 0; }
        .dt-action .dt-info { flex: 1; }
        .dt-action .dt-name { font-size: 12px; font-weight: 600; color: var(--text-bright); margin-bottom: 2px; }
        .dt-action .dt-desc { font-size: 10px; color: var(--text-dim); }

        /* Email reports */
        .er-modal { width: 540px; }
        .er-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
        .er-back { background: none; border: none; color: var(--text-muted); font-size: 16px; cursor: pointer; padding: 0 8px 0 0; }
        .er-back:hover { color: var(--text-bright); }
        .er-table { width: 100%; border-collapse: collapse; }
        .er-table th { text-align: left; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--text-dim); padding: 6px 8px; border-bottom: 1px solid var(--border); }
        .er-table td { font-size: 11px; padding: 8px 8px; border-bottom: 1px solid rgba(28,35,51,0.4); color: var(--text-muted); cursor: pointer; }
        .er-table tr:hover td { color: var(--text); background: var(--bg-surface); }
        .er-empty { text-align: center; color: var(--text-dim); font-style: italic; padding: 24px; font-size: 11px; }
        .er-trash { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 13px; padding: 2px 6px; border-radius: 4px; }
        .er-trash:hover { color: var(--red); background: var(--red-bg); }
        .er-sections-table { width: 100%; border-collapse: collapse; margin-top: 4px; }
        .er-sections-table td { padding: 6px 0; border-bottom: 1px solid rgba(28,35,51,0.3); font-size: 12px; color: var(--text); }
        .er-sections-table tr:last-child td { border-bottom: none; }
        .er-section-name { font-weight: 600; text-transform: capitalize; min-width: 80px; }
        .er-section-check { width: 28px; }
        .er-section-check input { accent-color: var(--blue); }
        .er-pills { display: flex; gap: 3px; }
        .er-pill { padding: 3px 10px; border: 1px solid var(--border); border-radius: 12px; background: transparent; color: var(--text-dim); font-size: 10px; font-weight: 600; cursor: pointer; transition: all 0.12s; }
        .er-pill:hover { border-color: var(--border-hover); color: var(--text-muted); }
        .er-pill.active { background: var(--blue-bg); border-color: rgba(88,166,255,0.3); color: var(--blue); }
        .er-pill.disabled { opacity: 0.3; pointer-events: none; }
        .er-cadence { display: flex; gap: 3px; margin-top: 4px; }
        .er-cadence-pill { padding: 3px 10px; border: 1px solid var(--border); border-radius: 12px; background: transparent; color: var(--text-dim); font-size: 10px; font-weight: 600; cursor: pointer; transition: all 0.12s; }
        .er-cadence-pill:hover { border-color: var(--border-hover); color: var(--text-muted); }
        .er-cadence-pill.active { background: var(--blue-bg); border-color: rgba(88,166,255,0.3); color: var(--blue); }
        .er-cadence-day { display: flex; gap: 3px; flex-wrap: wrap; align-items: center; }
        .er-cadence-day-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-dim); margin-right: 4px; }
        .er-day-pill { padding: 3px 10px; border: 1px solid var(--border); border-radius: 12px; background: transparent; color: var(--text-dim); font-size: 10px; font-weight: 600; cursor: pointer; transition: all 0.12s; min-width: 28px; text-align: center; }
        .er-day-pill:hover { border-color: var(--border-hover); color: var(--text-muted); }
        .er-day-pill.active { background: var(--blue-bg); border-color: rgba(88,166,255,0.3); color: var(--blue); }
        .er-day-input { width: 56px; padding: 3px 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 11px; font-weight: 600; text-align: center; }
        .er-day-input:focus { outline: none; border-color: var(--blue); }

        /* Toast */
        .t-toast { padding: 7px 16px; border-radius: 8px; font-size: 11px; font-weight: 600; backdrop-filter: blur(12px); box-shadow: 0 4px 20px rgba(0,0,0,0.5); display: flex; align-items: center; gap: 6px; animation: tIn 0.2s ease; }
        .t-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
        .t-toast.success { background: rgba(17,22,32,0.95); color: var(--green); border: 1px solid rgba(63,185,80,0.15); }
        .t-toast.success .t-dot { background: var(--green); }
        .t-toast.error { background: rgba(17,22,32,0.95); color: var(--red); border: 1px solid rgba(248,81,73,0.15); }
        .t-toast.error .t-dot { background: var(--red); }
        .t-toast.info { background: rgba(17,22,32,0.95); color: var(--text-muted); border: 1px solid var(--border); }
        .t-toast.info .t-dot { background: var(--blue); }
        @keyframes tIn { from { opacity:0; transform: translateY(6px) scale(0.97); } to { opacity:1; transform: none; } }

        @media (max-width: 1000px) {
          .stat-row { grid-template-columns: repeat(2, 1fr); }
          .charts { grid-template-columns: 1fr; }
          .panels { grid-template-columns: 1fr; }
        }
        @media (max-width: 500px) { .stat-row { grid-template-columns: 1fr; } }
      `}</style>
    </>
  );
}
