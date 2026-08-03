/** DateRangePicker — the audit-history window control.
 *
 *  Replaces the pair of `datetime-local` inputs. One button shows the current
 *  range; clicking it opens a two-month calendar where the FIRST click sets the
 *  start and the SECOND sets the end — no second field to go hunting for, and
 *  no native time spinner. A preset row sits above it (Today / This week / Last
 *  week / 7D / 30D / All time); the reference picker's preset side-column is
 *  deliberately not here — these ARE the presets.
 *
 *  It owns no filter state of its own. It writes epoch-ms into the form's
 *  hidden `since` / `until` inputs, resets the page to 1 (gotcha #7 — a stale
 *  page number renders "N in window / no rows"), then fires the same
 *  htmx.ajax refresh every other control on the bar uses. That keeps the form
 *  the single source of truth for query params.
 *
 *  All boundaries are the VIEWER's local day, not UTC — a manager filtering
 *  "today" means their today. */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

interface Props {
  /** Current window, epoch ms. `since` of 0 means all-time. */
  since: number;
  until: number;
  /** Hidden inputs this writes into, and the table it refreshes. */
  sinceInputId?: string;
  untilInputId?: string;
  pageInputId?: string;
  formId?: string;
  targetId?: string;
  endpoint?: string;
}

type PresetId = "today" | "week" | "lastweek" | "7d" | "30d" | "all";

const MS_DAY = 86_400_000;
const DOW = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const startOfDay = (d: Date): Date => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const endOfDay = (d: Date): Date => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };

/** Monday of the week `d` falls in. JS getDay() is Sunday-based (0), and the
 *  floor here is Monday, so Sunday has to reach back six days, not zero. */
function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const dow = x.getDay();
  x.setDate(x.getDate() - (dow === 0 ? 6 : dow - 1));
  return x;
}

/** [since, until] for a preset, in epoch ms. Exported for unit tests. */
export function presetRange(id: PresetId, now: Date): [number, number] {
  const nowMs = now.getTime();
  switch (id) {
    case "today":
      return [startOfDay(now).getTime(), nowMs];
    case "week":
      return [startOfWeek(now).getTime(), nowMs];
    case "lastweek": {
      const thisMonday = startOfWeek(now);
      const lastMonday = new Date(thisMonday);
      lastMonday.setDate(lastMonday.getDate() - 7);
      const lastSunday = new Date(thisMonday);
      lastSunday.setDate(lastSunday.getDate() - 1);
      return [lastMonday.getTime(), endOfDay(lastSunday).getTime()];
    }
    case "7d":
      return [nowMs - 7 * MS_DAY, nowMs];
    case "30d":
      return [nowMs - 30 * MS_DAY, nowMs];
    case "all":
      return [0, nowMs];
  }
}

const PRESETS: Array<{ id: PresetId; label: string }> = [
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "lastweek", label: "Last week" },
  { id: "7d", label: "7D" },
  { id: "30d", label: "30D" },
  { id: "all", label: "All time" },
];

const fmtDay = (ms: number): string =>
  new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** Label on the trigger button. All-time has no meaningful start date. */
export function rangeLabel(since: number, until: number): string {
  if (!since) return `All time → ${fmtDay(until)}`;
  return `${fmtDay(since)} → ${fmtDay(until)}`;
}

/** Days to render for a month grid, Monday-first, padded with the blanks that
 *  keep the 1st under its real weekday. */
function monthGrid(year: number, month: number): Array<Date | null> {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() === 0 ? 6 : first.getDay() - 1);
  const days = new Date(year, month + 1, 0).getDate();
  const cells: Array<Date | null> = Array(lead).fill(null);
  for (let d = 1; d <= days; d++) cells.push(new Date(year, month, d));
  return cells;
}

export default function DateRangePicker(props: Props) {
  const {
    sinceInputId = "ah-since", untilInputId = "ah-until", pageInputId = "ah-page",
    formId = "audit-history-filters", targetId = "audit-history-table",
    endpoint = "/api/manager/audit-history",
  } = props;

  const [since, setSince] = useState(props.since);
  const [until, setUntil] = useState(props.until);
  const [open, setOpen] = useState(false);
  /** First click of a new range — end not chosen yet. */
  const [pendingStart, setPendingStart] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [view, setView] = useState(() => {
    // Anchor on the month BEFORE the window's end, so the pair reads
    // [previous, current] — audit windows point backwards, not forwards.
    const anchor = new Date(props.until || Date.now());
    anchor.setDate(1);
    anchor.setMonth(anchor.getMonth() - 1);
    return { year: anchor.getFullYear(), month: anchor.getMonth() };
  });
  const rootRef = useRef<HTMLDivElement>(null);

  // Click-away and Escape close the popover without applying anything.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) cancel();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cancel(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function cancel() {
    setOpen(false);
    setPendingStart(null);
    setHovered(null);
  }

  /** Write the window into the form and refresh the table. */
  function apply(nextSince: number, nextUntil: number) {
    setSince(nextSince);
    setUntil(nextUntil);
    const s = document.getElementById(sinceInputId) as HTMLInputElement | null;
    const u = document.getElementById(untilInputId) as HTMLInputElement | null;
    const p = document.getElementById(pageInputId) as HTMLInputElement | null;
    if (s) s.value = String(nextSince);
    if (u) u.value = String(nextUntil);
    // A narrower window can leave the old page number past the last page.
    if (p) p.value = "1";
    const htmx = (globalThis as unknown as { htmx?: { ajax: (m: string, u: string, o: unknown) => void } }).htmx;
    htmx?.ajax("GET", endpoint, { source: `#${formId}`, target: `#${targetId}`, swap: "innerHTML" });
  }

  function choosePreset(id: PresetId) {
    const [s, u] = presetRange(id, new Date());
    cancel();
    apply(s, u);
  }

  /** First click starts a range; second click closes it. Clicking a day before
   *  the pending start flips them rather than rejecting the click. */
  function chooseDay(day: Date) {
    if (pendingStart == null) {
      setPendingStart(startOfDay(day).getTime());
      setHovered(null);
      return;
    }
    const a = pendingStart;
    const b = startOfDay(day).getTime();
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    cancel();
    apply(lo, endOfDay(new Date(hi)).getTime());
  }

  const activePreset = useMemo(() => {
    const now = new Date();
    return PRESETS.find(({ id }) => {
      const [s, u] = presetRange(id, now);
      // `until` for an open-ended preset is "now", which has already moved on
      // by the time we compare — a minute of slack keeps the pill lit.
      return Math.abs(s - since) < 1000 && Math.abs(u - until) < 60_000;
    })?.id ?? null;
  }, [since, until]);

  const months = [view, view.month === 11 ? { year: view.year + 1, month: 0 } : { year: view.year, month: view.month + 1 }];
  const selStart = pendingStart ?? since;
  const selEnd = pendingStart != null ? (hovered ?? pendingStart) : until;
  const lo = Math.min(selStart, selEnd);
  const hi = Math.max(selStart, selEnd);

  const todayMs = startOfDay(new Date()).getTime();

  function dayClass(d: Date): string {
    const t = d.getTime();
    const dayEnd = endOfDay(d).getTime();
    const isEdge = startOfDay(new Date(lo)).getTime() === t || startOfDay(new Date(hi)).getTime() === t;
    const inRange = dayEnd >= lo && t <= hi;
    return [
      "drp-day",
      inRange ? "in-range" : "",
      isEdge && (since || pendingStart != null) ? "edge" : "",
      t === todayMs ? "today" : "",
    ].filter(Boolean).join(" ");
  }

  return (
    <div class="drp" ref={rootRef}>
      <div class="drp-presets">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            class={`btn btn-ghost btn-sm${activePreset === p.id ? " drp-preset-on" : ""}`}
            onClick={() => choosePreset(p.id)}
          >{p.label}</button>
        ))}
      </div>
      <button type="button" class="drp-trigger" onClick={() => (open ? cancel() : setOpen(true))}>
        <span class="drp-cal">&#128197;</span>
        <span>{rangeLabel(since, until)}</span>
      </button>

      {open && (
        <div class="drp-pop">
          <div class="drp-head">
            <span class="drp-hint">
              {pendingStart == null ? "Pick the start date" : `Start ${fmtDay(pendingStart)} — now pick the end date`}
            </span>
            <span class="drp-nav">
              <button type="button" class="btn btn-ghost btn-sm" onClick={() =>
                setView((v) => v.month === 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: v.month - 1 })}
              >&larr;</button>
              <button type="button" class="btn btn-ghost btn-sm" onClick={() =>
                setView((v) => v.month === 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: v.month + 1 })}
              >&rarr;</button>
            </span>
          </div>
          <div class="drp-months">
            {months.map((m) => (
              <div class="drp-month" key={`${m.year}-${m.month}`}>
                <div class="drp-month-title">{MONTHS[m.month]} {m.year}</div>
                <div class="drp-grid">
                  {DOW.map((d) => <div class="drp-dow" key={d}>{d}</div>)}
                  {monthGrid(m.year, m.month).map((d, i) => d === null
                    ? <div key={`b${i}`} />
                    : (
                      <button
                        key={d.getTime()}
                        type="button"
                        class={dayClass(d)}
                        onMouseEnter={() => pendingStart != null && setHovered(startOfDay(d).getTime())}
                        onClick={() => chooseDay(d)}
                      >{d.getDate()}</button>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
