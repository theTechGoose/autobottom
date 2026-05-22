/** Compact range selector for dashboard stat panels. Pure HTMX, no inline JS.
 *
 *  Preset buttons set the range via `hx-vals` on the click; custom inputs
 *  drive the same target via a small wrapped form. Active preset is
 *  highlighted via the `data-active-range` attribute mirroring the
 *  currently-selected range on the target container, which the fragment
 *  route writes back on every render.
 *
 *  Usage:
 *    <StatRangeBar target="#judge-dash-block" endpoint="/api/judge/dashboard-range" active="week" />
 *    <div id="judge-dash-block" hx-get="/api/judge/dashboard-range?range=week" hx-trigger="load">…</div>
 */

const MS_DAY = 86_400_000;

export interface PresetRange { key: string; label: string; fromMs: () => number; toMs: () => number }

/** Default presets — same set on every dashboard. */
export const RANGE_PRESETS: PresetRange[] = [
  {
    key: "week",
    label: "This Week",
    fromMs: () => Date.now() - 7 * MS_DAY,
    toMs: () => Date.now(),
  },
  {
    key: "month",
    label: "This Month",
    fromMs: () => Date.now() - 30 * MS_DAY,
    toMs: () => Date.now(),
  },
  {
    key: "90d",
    label: "Last 90d",
    fromMs: () => Date.now() - 90 * MS_DAY,
    toMs: () => Date.now(),
  },
  {
    key: "all",
    label: "All Time",
    fromMs: () => 0,
    toMs: () => Date.now(),
  },
];

interface Props {
  target: string;        // CSS selector for the swap target
  endpoint: string;      // HTMX endpoint (returns a full panel render)
  active?: string;       // currently-active preset key
}

export function StatRangeBar({ target, endpoint, active = "all" }: Props) {
  return (
    <div class="stat-range-bar" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;padding:10px 12px;background:var(--bg-2);border:1px solid var(--border);border-radius:8px;">
      <span style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-right:4px;">Range</span>
      {RANGE_PRESETS.map((p) => (
        <button
          key={p.key}
          type="button"
          class={`sf-btn ${p.key === active ? "primary" : "ghost"}`}
          style="font-size:11px;padding:4px 12px;"
          hx-get={`${endpoint}?range=${p.key}`}
          hx-target={target}
          hx-swap="outerHTML"
          hx-indicator={target}
        >{p.label}</button>
      ))}
      <form
        style="display:flex;align-items:center;gap:6px;margin-left:auto;"
        hx-get={endpoint}
        hx-target={target}
        hx-swap="outerHTML"
        hx-indicator={target}
        hx-trigger="submit"
      >
        <input type="hidden" name="range" value="custom" />
        <input type="date" name="from" class="sf-input" style="font-size:11px;padding:2px 6px;" />
        <span style="color:var(--text-dim);font-size:11px;">→</span>
        <input type="date" name="to" class="sf-input" style="font-size:11px;padding:2px 6px;" />
        <button type="submit" class="sf-btn primary" style="font-size:11px;padding:4px 12px;">Apply</button>
      </form>
    </div>
  );
}

/** Resolve a `?range=` preset key (or custom from/to ms) to a {from, to} pair.
 *  Used by fragment route handlers. */
export function resolveRangeFromQuery(url: URL): { range: string; from: number; to: number; label: string } {
  const range = url.searchParams.get("range") ?? "all";
  if (range === "custom") {
    const fromStr = url.searchParams.get("from") ?? "";
    const toStr = url.searchParams.get("to") ?? "";
    // <input type="date"> gives YYYY-MM-DD; treat as midnight UTC start +
    // end-of-day for `to` so a "to: May 22" includes May 22.
    const from = fromStr ? Date.parse(fromStr + "T00:00:00Z") : 0;
    const toRaw = toStr ? Date.parse(toStr + "T00:00:00Z") : Date.now();
    const to = toStr ? toRaw + MS_DAY - 1 : toRaw;
    const label = `${fromStr || "epoch"} → ${toStr || "now"}`;
    return { range, from, to, label };
  }
  const preset = RANGE_PRESETS.find((p) => p.key === range) ?? RANGE_PRESETS[RANGE_PRESETS.length - 1];
  return {
    range: preset.key,
    from: preset.fromMs(),
    to: preset.toMs(),
    label: preset.label,
  };
}
