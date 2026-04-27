/** Shared HTMX fragment renderers for Question Lab. */
import { renderToString } from "preact-render-to-string";
import { apiFetch } from "./api.ts";

interface QLConfig { id: string; name: string; type: "internal" | "partner"; }

function pillForType(type: string) {
  return type === "internal" ? "pill-blue" : "pill-purple";
}

export async function renderConfigList(req: Request, activeConfigId?: string): Promise<string> {
  let configs: QLConfig[] = [];
  try {
    const d = await apiFetch<{ configs: QLConfig[] }>("/api/qlab/configs", req);
    configs = d.configs ?? [];
  } catch {}
  return renderToString(
    <div id="qlab-config-list">
      {configs.length === 0 ? (
        <div style="color:var(--text-dim);font-size:12px;text-align:center;padding:20px;">
          No configurations yet
        </div>
      ) : configs.map((c) => (
        <a
          key={c.id}
          href={`/question-lab?configId=${c.id}`}
          class="qlab-config-item"
          style={c.id === activeConfigId
            ? "background:var(--bg-surface);border-color:var(--accent);"
            : ""}
        >
          <div class="qlab-config-name">{c.name}</div>
          <div class="qlab-config-meta">
            <span class={`pill ${pillForType(c.type)}`}>{c.type}</span>
          </div>
        </a>
      ))}
    </div>,
  );
}

export function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export function errorFragment(msg: string): string {
  return `<div style="color:var(--red);font-size:11px;padding:8px;">${escapeHtml(msg)}</div>`;
}

export function okFragment(msg: string): string {
  return `<div style="color:var(--green);font-size:11px;padding:8px;">${escapeHtml(msg)}</div>`;
}

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
