/** Cron-string helpers for the email-report scheduler.
 *
 *  The matcher does NOT do EST↔UTC arithmetic. It uses Intl.DateTimeFormat to
 *  project Date.now() into the configured IANA timezone and matches the
 *  cron fields against that wall-clock projection. Deno's V8 ships full ICU
 *  data so this needs no extra dependency, and it's DST-safe by construction:
 *  a "Daily 8am America/New_York" schedule fires at 8am local time year-round
 *  rather than drifting an hour every spring/fall.
 *
 *  Grammar supports the typical operator paste from crontab.guru:
 *  `*`, integer literals, ranges `a-b`, lists `1,3,5`, step `* / n`, and
 *  the standard `7 ≡ 0` Sunday alias in dayOfWeek. POSIX OR semantics for
 *  the dayOfMonth × dayOfWeek pair (both non-* → match if either matches). */

export type Preset = "Disabled" | "Daily" | "Weekly" | "Monthly" | "Custom";

export interface PresetShape {
  preset: Preset;
  dayOfWeek?: number;   // 0=Sunday … 6=Saturday (Weekly only)
  dayOfMonth?: number;  // 1-28 (Monthly only — UI gates 29-31)
  timeOfDay?: string;   // "HH:mm" in the schedule's tz
}

export interface CronSpec {
  cron: string;
  tz: string;           // IANA name, e.g. "America/New_York"
}

export const DEFAULT_TZ = "America/New_York";

/** Convert a UI preset shape into a 5-field cron string (in the schedule's tz). */
export function presetToCron(shape: PresetShape): CronSpec | null {
  if (shape.preset === "Disabled") return null;
  if (shape.preset === "Custom") return null;
  const [hh, mm] = parseTimeOfDay(shape.timeOfDay ?? "09:00");
  switch (shape.preset) {
    case "Daily":
      return { cron: `${mm} ${hh} * * *`, tz: DEFAULT_TZ };
    case "Weekly": {
      const dow = clamp(shape.dayOfWeek ?? 1, 0, 6);
      return { cron: `${mm} ${hh} * * ${dow}`, tz: DEFAULT_TZ };
    }
    case "Monthly": {
      const dom = clamp(shape.dayOfMonth ?? 1, 1, 28);
      return { cron: `${mm} ${hh} ${dom} * *`, tz: DEFAULT_TZ };
    }
  }
  return null;
}

/** Best-effort inverse: take a cron string and try to recover the UI shape.
 *  Anything non-canonical (ranges, lists, steps) falls back to "Custom". */
export function parseCronToPreset(cron: string, _tz: string): PresetShape {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return { preset: "Custom" };
  const [minF, hourF, domF, monF, dowF] = fields;
  // Only literal minute + literal hour can drive the preset picker.
  const min = literal(minF);
  const hour = literal(hourF);
  if (min === null || hour === null) return { preset: "Custom" };
  if (monF !== "*") return { preset: "Custom" };
  const timeOfDay = `${pad2(hour)}:${pad2(min)}`;
  if (domF === "*" && dowF === "*") {
    return { preset: "Daily", timeOfDay };
  }
  if (domF === "*" && literal(dowF) !== null) {
    return { preset: "Weekly", dayOfWeek: literal(dowF)!, timeOfDay };
  }
  if (dowF === "*" && literal(domF) !== null) {
    const dom = literal(domF)!;
    if (dom >= 1 && dom <= 28) return { preset: "Monthly", dayOfMonth: dom, timeOfDay };
  }
  return { preset: "Custom" };
}

interface ParsedCron {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domWild: boolean;
  dowWild: boolean;
}

/** Parse a single cron field into the set of matching ints in [lo, hi].
 *  Grammar: `*`, integer literals, ranges `a-b`, lists `1,3,5`, step `* / n`.
 *  Returns null on grammar error (caller treats as "never match"). */
function parseField(field: string, lo: number, hi: number): Set<number> | null {
  const out = new Set<number>();
  const parts = field.split(",");
  for (const part of parts) {
    if (part === "*") {
      for (let v = lo; v <= hi; v++) out.add(v);
      continue;
    }
    // Step form: */n or a-b/n or a/n
    const stepMatch = part.match(/^([^/]+)\/(\d+)$/);
    if (stepMatch) {
      const base = stepMatch[1];
      const step = Number(stepMatch[2]);
      if (!Number.isFinite(step) || step < 1) return null;
      let rangeLo: number, rangeHi: number;
      if (base === "*") { rangeLo = lo; rangeHi = hi; }
      else {
        const r = parseRange(base, lo, hi);
        if (!r) return null;
        rangeLo = r.lo; rangeHi = r.hi;
      }
      for (let v = rangeLo; v <= rangeHi; v += step) out.add(v);
      continue;
    }
    // Range a-b
    if (part.includes("-")) {
      const r = parseRange(part, lo, hi);
      if (!r) return null;
      for (let v = r.lo; v <= r.hi; v++) out.add(v);
      continue;
    }
    // Literal
    const n = Number(part);
    if (!Number.isFinite(n) || n < lo || n > hi) return null;
    out.add(n);
  }
  return out;
}

function parseRange(s: string, lo: number, hi: number): { lo: number; hi: number } | null {
  const m = s.match(/^(\d+)-(\d+)$/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < lo || b > hi || a > b) return null;
  return { lo: a, hi: b };
}

function parseCronOrNull(cron: string): ParsedCron | null {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minF, hourF, domF, monF, dowF] = fields;
  const minute = parseField(minF, 0, 59);
  const hour = parseField(hourF, 0, 23);
  const dom = parseField(domF, 1, 31);
  const month = parseField(monF, 1, 12);
  // dayOfWeek: accept 0-7 (with 7 ≡ 0 Sunday alias).
  const dowRaw = parseField(dowF, 0, 7);
  if (!minute || !hour || !dom || !month || !dowRaw) return null;
  const dow = new Set(dowRaw);
  if (dow.has(7)) { dow.delete(7); dow.add(0); }
  return {
    minute, hour, dom, month, dow,
    domWild: domF === "*",
    dowWild: dowF === "*",
  };
}

/** Per-tz formatter cache. Constructing an Intl.DateTimeFormat is by far the
 *  most expensive part of a match, and the walk helpers below call this once
 *  per candidate minute — up to 180 (lastFireAtOrBefore) or 10,080
 *  (nextFireAt) times for a single question. The set of tz strings in play is
 *  tiny and fixed, so cache them outright. */
const _dtfCache = new Map<string, Intl.DateTimeFormat>();

function dtfFor(tz: string): Intl.DateTimeFormat {
  let dtf = _dtfCache.get(tz);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
      hour12: false,
    });
    _dtfCache.set(tz, dtf);
  }
  return dtf;
}

/** Project nowMs into the schedule's tz and return the cron-relevant fields. */
function wallClockInTz(tz: string, nowMs: number): { minute: number; hour: number; dom: number; month: number; dow: number } {
  const dtf = dtfFor(tz);
  const parts = dtf.formatToParts(new Date(nowMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let hour = Number(get("hour"));
  // Intl returns "24" for midnight in en-US hour12:false; normalize to 0.
  if (hour === 24) hour = 0;
  return {
    minute: Number(get("minute")),
    hour,
    dom: Number(get("day")),
    month: Number(get("month")),
    dow: weekdayMap[get("weekday")] ?? 0,
  };
}

/** Does the given UTC instant match the cron expression evaluated in tz?
 *  Returns false (never throws) on unparseable cron — config sits dormant. */
export function matchesCron(cron: string, tz: string, nowMs: number): boolean {
  const parsed = parseCronOrNull(cron);
  if (!parsed) return false;
  return matchesParsed(parsed, tz, nowMs);
}

/** Match against an already-parsed cron — lets the walk helpers parse once
 *  rather than re-parsing the string for every candidate minute. */
function matchesParsed(parsed: ParsedCron, tz: string, nowMs: number): boolean {
  const wc = wallClockInTz(tz, nowMs);
  if (!parsed.minute.has(wc.minute)) return false;
  if (!parsed.hour.has(wc.hour)) return false;
  if (!parsed.month.has(wc.month)) return false;
  // POSIX OR semantics for dom × dow when both are non-wild.
  if (parsed.domWild && parsed.dowWild) return true;
  if (parsed.domWild) return parsed.dow.has(wc.dow);
  if (parsed.dowWild) return parsed.dom.has(wc.dom);
  return parsed.dom.has(wc.dom) || parsed.dow.has(wc.dow);
}

/** Walk forward minute-by-minute up to `maxMinutes` looking for the next
 *  instant that matches the cron. Returns ms-epoch or null if no match in
 *  the search horizon. Caller uses this for the "next fires at …" UI badge. */
export function nextFireAt(cron: string, tz: string, fromMs: number, maxMinutes = 60 * 24 * 7): number | null {
  const parsed = parseCronOrNull(cron);
  if (!parsed) return null;
  // Round up to the next minute boundary so we don't match the current minute.
  const start = Math.ceil((fromMs + 1) / 60_000) * 60_000;
  for (let i = 0; i < maxMinutes; i++) {
    const t = start + i * 60_000;
    if (matchesParsed(parsed, tz, t)) return t;
  }
  return null;
}

/** Walk BACKWARD minute-by-minute from `fromMs` looking for the most recent
 *  instant at or before it that matches the cron. Returns ms-epoch (floored to
 *  the minute), or null if nothing matched within `maxMinutes`.
 *
 *  This is the mirror of `nextFireAt`, and it is what lets the tick tell
 *  "this config's 9:00 slot already passed and was missed" apart from
 *  "9:00 isn't due today at all" — without it a tick can only ever ask
 *  "is it exactly 9:00 right now?", so a crash at 9:00 loses the whole day.
 *  See the catch-up guard in email-reports-tick. */
export function lastFireAtOrBefore(
  cron: string,
  tz: string,
  fromMs: number,
  maxMinutes = 180,
): number | null {
  const parsed = parseCronOrNull(cron);
  if (!parsed) return null;
  const start = Math.floor(fromMs / 60_000) * 60_000;
  for (let i = 0; i < maxMinutes; i++) {
    const t = start - i * 60_000;
    if (matchesParsed(parsed, tz, t)) return t;
  }
  return null;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function literal(field: string): number | null {
  const n = Number(field);
  return Number.isFinite(n) ? n : null;
}

function parseTimeOfDay(s: string): [number, number] {
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return [9, 0];
  const hh = clamp(Number(m[1]), 0, 23);
  const mm = clamp(Number(m[2]), 0, 59);
  return [hh, mm];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}
