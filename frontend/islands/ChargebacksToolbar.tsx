/** Chargebacks modal toolbar — owns tab state, Pull Report, Download
 *  (CSV/XLSX), Post-to-Sheet, and renders the data tables.
 *
 *  Data flow: pull JSON from `/api/admin/chargebacks-json` (raw backend shape:
 *  ChargebackEntry / WireDeductionEntry). Format dates / revenue / CRM links
 *  at render time — matches prod's behaviour and keeps the island the single
 *  source of truth for the display shape (CSV / XLSX / Sheets all project
 *  from the same raw entries). */
import { useEffect, useRef, useState } from "preact/hooks";

type Tab = "cb" | "wire";

// Backend shapes — must match src/core/dto/types.ts ChargebackEntry / WireDeductionEntry.
interface CbEntry {
  findingId: string;
  ts: number;
  voName: string;
  destination: string;
  revenue: string;
  recordId: string;
  score: number;
  failedQHeaders: string[];
  egregiousHeaders?: string[];
  omissionHeaders?: string[];
}
interface WireEntry {
  findingId: string;
  ts: number;
  score: number;
  questionsAudited: number;
  totalSuccess: number;
  recordId: string;
  office: string;
  excellenceAuditor: string;
  guestName: string;
}

declare global {
  // deno-lint-ignore no-explicit-any
  interface Window { XLSX?: any; }
}

// QuickBase deep-link templates — match prod's dashboard/page.ts.
const QB_DATE_URL = "https://monsterrg.quickbase.com/nav/app/bmhvhc7sk/table/bpb28qsnn/action/dr?rid=";
const QB_PKG_URL = "https://monsterrg.quickbase.com/nav/app/bmhvhc7sk/table/bttffb64u/action/dr?rid=";

function toMs(date: string, endOfDay = false): number {
  const [y, m, d] = date.split("-").map((n) => Number(n));
  const t = new Date(y, (m ?? 1) - 1, d ?? 1, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0);
  return t.getTime();
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const date = `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  return `${date} ${time}`;
}

function fmtRevenue(r: string): string {
  if (!r) return "";
  const n = parseFloat(r);
  return isNaN(n) ? r : `$${n.toFixed(2)}`;
}

function teamMember(e: CbEntry): string {
  return e.voName || e.destination || "";
}

function cbCrm(e: CbEntry): string {
  return e.recordId ? `${QB_DATE_URL}${encodeURIComponent(e.recordId)}` : "";
}
function wireCrm(e: WireEntry): string {
  return e.recordId ? `${QB_PKG_URL}${encodeURIComponent(e.recordId)}` : "";
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function cbToRows(entries: CbEntry[], type: "Chargeback" | "Omission"): (string | number)[][] {
  const header = ["Date", "Team Member", "Revenue", "CRM", "Audit", "Type", "Failed Questions"];
  const body = entries.map((e) => [
    fmtDate(e.ts),
    teamMember(e),
    fmtRevenue(e.revenue),
    cbCrm(e),
    e.findingId ? `${globalThis.location?.origin ?? ""}/audit/report?id=${e.findingId}` : "",
    type,
    (e.failedQHeaders ?? []).join("; "),
  ]);
  return [header, ...body];
}
function wireToRows(entries: WireEntry[]): (string | number)[][] {
  const header = ["Date", "Score %", "Questions", "Passed", "CRM", "Audit", "Office", "Auditor", "Guest"];
  const body = entries.map((e) => [
    fmtDate(e.ts),
    typeof e.score === "number" ? e.score : "",
    typeof e.questionsAudited === "number" ? e.questionsAudited : "",
    typeof e.totalSuccess === "number" ? e.totalSuccess : "",
    wireCrm(e),
    e.findingId ? `${globalThis.location?.origin ?? ""}/audit/report?id=${e.findingId}` : "",
    e.office ?? "",
    e.excellenceAuditor ?? "",
    e.guestName ?? "",
  ]);
  return [header, ...body];
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function rowsToCsv(rows: (string | number)[][]): string {
  return rows.map((row) =>
    row.map((cell) => {
      const s = String(cell ?? "");
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    }).join(",")
  ).join("\n");
}

async function loadXlsxLib(): Promise<void> {
  if (globalThis.window?.XLSX) return;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("failed to load xlsx library"));
    document.head.appendChild(s);
  });
}

interface Props { initialTab?: Tab; }

export default function ChargebacksToolbar({ initialTab = "cb" }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [cbs, setCbs] = useState<CbEntry[]>([]);
  const [omissions, setOmissions] = useState<CbEntry[]>([]);
  const [wires, setWires] = useState<WireEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const formatRef = useRef<HTMLSelectElement | null>(null);

  function switchTab(next: Tab) {
    if (next === tab) return;
    setTab(next);
    setLoaded(false);
    setCbs([]); setOmissions([]); setWires([]);
    setMsg(null);
  }

  function readDateInputs(): { since: number; until: number } | null {
    const from = (document.getElementById("cb-date-from") as HTMLInputElement | null)?.value;
    const to = (document.getElementById("cb-date-to") as HTMLInputElement | null)?.value;
    if (!from || !to) { setMsg({ kind: "err", text: "Pick a date range first." }); return null; }
    return { since: toMs(from), until: toMs(to, true) };
  }

  async function pull() {
    const range = readDateInputs();
    if (!range) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/chargebacks-json?tab=${tab}&since=${range.since}&until=${range.until}`, {
        credentials: "include",
      });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok || (data as { error?: string }).error) {
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      if (tab === "wire") {
        setWires(((data as { items?: WireEntry[] }).items) ?? []);
        setCbs([]); setOmissions([]);
      } else {
        const d = data as { chargebacks?: CbEntry[]; omissions?: CbEntry[] };
        setCbs(d.chargebacks ?? []);
        setOmissions(d.omissions ?? []);
        setWires([]);
      }
      setLoaded(true);
      setMsg({ kind: "ok", text: "Report loaded." });
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function downloadCsv() {
    if (!loaded) { setMsg({ kind: "err", text: "Pull the report first." }); return; }
    const now = new Date().toISOString().slice(0, 10);
    if (tab === "wire") {
      downloadBlob(new Blob([rowsToCsv(wireToRows(wires))], { type: "text/csv;charset=utf-8" }), `wire-deductions-${now}.csv`);
    } else {
      const cbRows = cbToRows(cbs, "Chargeback");
      const omRows = cbToRows(omissions, "Omission");
      // Combine — header from cb, body of cb + body of om (omitting om's header)
      const combined = [...cbRows, [], ["Omissions"], ...omRows.slice(1)];
      downloadBlob(new Blob([rowsToCsv(combined)], { type: "text/csv;charset=utf-8" }), `chargebacks-${now}.csv`);
    }
    setMsg({ kind: "ok", text: "CSV downloaded." });
  }

  async function downloadXlsx() {
    if (!loaded) { setMsg({ kind: "err", text: "Pull the report first." }); return; }
    setBusy(true);
    setMsg(null);
    try {
      await loadXlsxLib();
      // deno-lint-ignore no-explicit-any
      const XLSX = (globalThis as any).XLSX;
      if (!XLSX) throw new Error("XLSX library not available");
      const wb = XLSX.utils.book_new();
      const now = new Date().toISOString().slice(0, 10);
      if (tab === "wire") {
        const ws = XLSX.utils.aoa_to_sheet(wireToRows(wires));
        XLSX.utils.book_append_sheet(wb, ws, "Wire Deductions");
        XLSX.writeFile(wb, `wire-deductions-${now}.xlsx`);
      } else {
        if (cbs.length) {
          XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cbToRows(cbs, "Chargeback")), "Chargebacks");
        }
        if (omissions.length) {
          XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cbToRows(omissions, "Omission")), "Omissions");
        }
        if (!cbs.length && !omissions.length) {
          XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["No data"]]), "Empty");
        }
        XLSX.writeFile(wb, `chargebacks-${now}.xlsx`);
      }
      setMsg({ kind: "ok", text: "XLSX downloaded." });
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function postToSheet() {
    if (!loaded) { setMsg({ kind: "err", text: "Pull the report first." }); return; }
    const range = readDateInputs();
    if (!range) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/post-to-sheet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          since: range.since,
          until: range.until,
          tabs: tab === "wire" ? "wire" : "cb,om",
        }),
      });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      const d = data as { ok?: boolean; appended?: number; message?: string; error?: string };
      if (!res.ok || d.error) throw new Error(d.error ?? `HTTP ${res.status}`);
      setMsg({ kind: "ok", text: d.appended != null ? `Posted ${d.appended} row${d.appended === 1 ? "" : "s"} to sheet.` : (d.message ?? "Posted.") });
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  // Auto-clear toast after 4s
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(t);
  }, [msg]);

  return (
    <>
      {/* Tabs portal — TabBarPortal effect renders buttons into #cb-tabs */}
      <TabBarPortal tab={tab} onSwitch={switchTab} />

      <button
        type="button"
        class="sf-btn primary"
        style="font-size:11px;"
        onClick={pull}
        disabled={busy}
      >{busy ? "Loading…" : "Pull Report"}</button>
      <select ref={formatRef} class="sf-input" style="font-size:11px;padding:5px 8px;width:70px;">
        <option value="csv">CSV</option>
        <option value="xlsx">XLSX</option>
      </select>
      <button
        type="button"
        class="sf-btn ghost"
        style="font-size:11px;"
        onClick={() => {
          const fmt = formatRef.current?.value ?? "csv";
          if (fmt === "xlsx") downloadXlsx(); else downloadCsv();
        }}
        disabled={busy || !loaded}
      >Download</button>
      <button
        type="button"
        class="sf-btn ghost"
        style="font-size:11px;"
        onClick={postToSheet}
        disabled={busy || !loaded}
      >Post to Sheet</button>
      {msg && (
        <span
          style={`font-size:10px;margin-left:8px;color:${msg.kind === "ok" ? "var(--green)" : "var(--red)"};`}
        >{msg.text}</span>
      )}
      <BodyRenderer tab={tab} cbs={cbs} omissions={omissions} wires={wires} loaded={loaded} />
    </>
  );
}

/** Renders the tab buttons into #cb-tabs (the dashboard's empty container). */
function TabBarPortal({ tab, onSwitch }: { tab: Tab; onSwitch: (next: Tab) => void }) {
  useEffect(() => {
    const host = document.getElementById("cb-tabs");
    if (!host) return;
    host.innerHTML = "";
    const make = (id: Tab, label: string) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      const active = tab === id;
      b.style.cssText = `font-size:11px;font-weight:600;padding:12px 16px;border:none;background:none;cursor:pointer;color:${active ? "var(--blue)" : "var(--text-dim)"};border-bottom:2px solid ${active ? "var(--blue)" : "transparent"};margin-bottom:-1px;font-family:inherit;`;
      b.addEventListener("click", () => onSwitch(id));
      host.appendChild(b);
    };
    make("cb", "Chargebacks & Omissions");
    make("wire", "Wire Deductions");
  }, [tab, onSwitch]);
  return null;
}

function BodyRenderer({ tab, cbs, omissions, wires, loaded }: { tab: Tab; cbs: CbEntry[]; omissions: CbEntry[]; wires: WireEntry[]; loaded: boolean }) {
  // Renders into #cb-body (the dashboard's empty container outside this island).
  useEffect(() => {
    const body = document.getElementById("cb-body");
    if (!body) return;

    // When unloaded (initial state OR tab just switched), reset to placeholder.
    // The previous version bailed early — leaving the prior tab's table visible.
    if (!loaded) {
      body.innerHTML = `<div style="color:var(--text-dim);font-size:12px;text-align:center;padding:60px 0;">Select a date range and pull the report.</div>`;
      return;
    }

    body.innerHTML = "";
    const frag = document.createElement("div");
    if (tab === "wire") {
      if (!wires.length) {
        frag.innerHTML = `<div style="color:var(--text-dim);font-size:12px;text-align:center;padding:40px 0;">No wire deductions for this period.</div>`;
      } else {
        const rows = wires.map((w) => `<tr style="border-bottom:1px solid var(--border);">
          <td style="padding:6px 10px;color:var(--text);">${escapeHtml(fmtDate(w.ts))}</td>
          <td style="padding:6px 10px;font-weight:700;">${typeof w.score === "number" ? w.score + "%" : "—"}</td>
          <td style="padding:6px 10px;color:var(--text);">${w.questionsAudited ?? "—"}</td>
          <td style="padding:6px 10px;color:var(--text);">${w.totalSuccess ?? "—"}</td>
          <td style="padding:6px 10px;">${w.recordId ? `<a href="${escapeHtml(wireCrm(w))}" target="_blank" class="tbl-link" style="color:var(--blue);text-decoration:none;">CRM</a>` : "—"}</td>
          <td style="padding:6px 10px;">${w.findingId ? `<a href="/audit/report?id=${encodeURIComponent(w.findingId)}" target="_blank" class="tbl-link" style="color:var(--blue);text-decoration:none;">Audit</a>` : "—"}</td>
          <td style="padding:6px 10px;color:var(--text-dim);">${escapeHtml(w.office ?? "")}</td>
          <td style="padding:6px 10px;color:var(--text-dim);">${escapeHtml(w.excellenceAuditor ?? "")}</td>
          <td style="padding:6px 10px;color:var(--text-dim);">${escapeHtml(w.guestName ?? "")}</td>
        </tr>`).join("");
        frag.innerHTML = `<div><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--cyan);margin-bottom:10px;">Wire Deductions (${wires.length})</div><table class="data-table" style="width:100%;border-collapse:collapse;font-size:11px;"><thead><tr style="border-bottom:1px solid var(--border);"><th style="text-align:left;padding:6px 10px;color:var(--text-dim);">Date</th><th style="text-align:left;padding:6px 10px;color:var(--text-dim);">Score</th><th style="text-align:left;padding:6px 10px;color:var(--text-dim);">Questions</th><th style="text-align:left;padding:6px 10px;color:var(--text-dim);">Passed</th><th style="text-align:left;padding:6px 10px;color:var(--text-dim);">CRM</th><th style="text-align:left;padding:6px 10px;color:var(--text-dim);">Audit</th><th style="text-align:left;padding:6px 10px;color:var(--text-dim);">Office</th><th style="text-align:left;padding:6px 10px;color:var(--text-dim);">Auditor</th><th style="text-align:left;padding:6px 10px;color:var(--text-dim);">Guest</th></tr></thead><tbody>${rows}</tbody></table></div>`;
      }
    } else {
      const renderRow = (e: CbEntry, type: "Chargeback" | "Omission") => `<tr style="border-bottom:1px solid var(--border);">
        <td style="padding:6px 10px;color:var(--text);">${escapeHtml(fmtDate(e.ts))}</td>
        <td style="padding:6px 10px;color:var(--text-bright);font-weight:500;">${escapeHtml(teamMember(e))}</td>
        <td style="padding:6px 10px;color:var(--green);">${escapeHtml(fmtRevenue(e.revenue))}</td>
        <td style="padding:6px 10px;">${e.recordId ? `<a href="${escapeHtml(cbCrm(e))}" target="_blank" class="tbl-link" style="color:var(--blue);text-decoration:none;">CRM</a>` : "—"}</td>
        <td style="padding:6px 10px;">${e.findingId ? `<a href="/audit/report?id=${encodeURIComponent(e.findingId)}" target="_blank" class="tbl-link" style="color:var(--blue);text-decoration:none;">Audit</a>` : "—"}</td>
        <td style="padding:6px 10px;font-weight:600;color:${type === "Chargeback" ? "var(--red)" : "var(--yellow)"};">${type}</td>
        <td style="padding:6px 10px;color:var(--text-dim);">${escapeHtml((e.failedQHeaders ?? []).join(", "))}</td>
      </tr>`;
      const cbRows = cbs.map((e) => renderRow(e, "Chargeback")).join("");
      const omRows = omissions.map((e) => renderRow(e, "Omission")).join("");
      if (!cbs.length && !omissions.length) {
        frag.innerHTML = `<div style="color:var(--text-dim);font-size:12px;text-align:center;padding:40px 0;">No chargebacks or omissions for this period.</div>`;
      } else {
        const tableHead = `<thead><tr style="border-bottom:1px solid var(--border);"><th style="text-align:left;padding:6px 10px;color:var(--text-dim);">Date</th><th style="text-align:left;padding:6px 10px;color:var(--text-dim);">Team Member</th><th style="text-align:left;padding:6px 10px;color:var(--text-dim);">Revenue</th><th style="text-align:left;padding:6px 10px;color:var(--text-dim);">CRM</th><th style="text-align:left;padding:6px 10px;color:var(--text-dim);">Audit</th><th style="text-align:left;padding:6px 10px;color:var(--text-dim);">Type</th><th style="text-align:left;padding:6px 10px;color:var(--text-dim);">Failed Qs</th></tr></thead>`;
        const cbBlock = cbs.length ? `<div style="margin-bottom:32px;"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--red);margin-bottom:10px;">Chargebacks (${cbs.length})</div><table class="data-table" style="width:100%;border-collapse:collapse;font-size:11px;">${tableHead}<tbody>${cbRows}</tbody></table></div>` : "";
        const omBlock = omissions.length ? `<div><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--yellow);margin-bottom:10px;">Omissions (${omissions.length})</div><table class="data-table" style="width:100%;border-collapse:collapse;font-size:11px;">${tableHead}<tbody>${omRows}</tbody></table></div>` : "";
        frag.innerHTML = `<div>${cbBlock}${omBlock}</div>`;
      }
    }
    body.appendChild(frag);
  }, [tab, cbs, omissions, wires, loaded]);
  return null;
}
