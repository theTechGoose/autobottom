/** Transcript panel — diarized transcript with speaker colors + clickable
 *  timestamp chips. Multi-column layout matches prod's `.transcript-body`.
 *  Plain SSR output; interactivity (click-to-seek, search, evidence highlight)
 *  is hydrated by a later TranscriptInteractive island. */

export interface TranscriptData {
  raw: string;
  diarized: string;
  utteranceTimes?: number[];
}

interface TranscriptPanelProps {
  transcript?: TranscriptData | null;
  snippet?: string;
}

function formatTime(ms: number | undefined): string | null {
  if (typeof ms !== "number") return null;
  const secs = Math.floor(ms / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

/** Parse a single diarized line: strip the [AGENT]/[CUSTOMER]/[SYSTEM] prefix
 *  and normalize speaker label. */
function parseLine(line: string): { speaker: "team" | "guest" | null; content: string } {
  const raw = line.trim();
  if (/^\[?AGENT\]?[:\s]/i.test(raw)) return { speaker: "team", content: raw.replace(/^\[?AGENT\]?:?\s*/i, "") };
  if (/^\[?CUSTOMER\]?[:\s]/i.test(raw)) return { speaker: "guest", content: raw.replace(/^\[?CUSTOMER\]?:?\s*/i, "") };
  if (/^\[TEAM MEMBER\][:\s]/i.test(raw)) return { speaker: "team", content: raw.replace(/^\[TEAM MEMBER\]:?\s*/i, "") };
  if (/^\[GUEST\][:\s]/i.test(raw)) return { speaker: "guest", content: raw.replace(/^\[GUEST\]:?\s*/i, "") };
  return { speaker: null, content: raw };
}

export function TranscriptPanel({ transcript, snippet }: TranscriptPanelProps) {
  // Prefer raw when utteranceTimes are present — prod does this because
  // the times array is indexed to the raw transcript lines, not the
  // diarized one. Fall back to diarized for older audits without times.
  const utteranceTimes = transcript?.utteranceTimes ?? [];
  const hasTimes = utteranceTimes.length > 0;
  const text = hasTimes
    ? (transcript?.raw || transcript?.diarized || "")
    : (transcript?.diarized || transcript?.raw || snippet || "");

  if (!text) {
    return (
      <div class="transcript-panel">
        <div class="transcript-empty">No transcript available</div>
      </div>
    );
  }

  const rawLines = text.split(/\r?\n/);
  // Non-empty lines WITH consecutive-duplicate suppression. Prod skips any
  // line that exactly matches the previously-emitted line to cut repeats
  // like "Perfect." / "Perfect." in rapid succession.
  const emitted: Array<{ line: string; ts: number | null }> = [];
  let lastTrim = "";
  let timeIdx = 0;
  for (const l of rawLines) {
    const trimmed = l.trim();
    if (!trimmed) continue;
    // Advance the time index even for duplicates so timestamps stay aligned
    // to the raw transcript position.
    const ts = utteranceTimes[timeIdx] ?? null;
    timeIdx++;
    if (trimmed === lastTrim) continue;
    lastTrim = trimmed;
    emitted.push({ line: l, ts });
  }

  return (
    <div class="transcript-panel">
      <div class="transcript-header">
        <span class="transcript-title">Transcript</span>
        <span class="transcript-count">{emitted.length} lines</span>
      </div>
      <div class="transcript-body transcript-multicol" id="transcript-body" data-utterance-times={JSON.stringify(utteranceTimes)}>
        {emitted.map(({ line, ts }, idx) => {
          const { speaker, content } = parseLine(line);
          const tsLabel = formatTime(ts ?? undefined);
          const label = speaker === "team" ? "TEAM MEMBER" : speaker === "guest" ? "GUEST" : null;
          return (
            <div
              key={idx}
              class={`t-line ${speaker ? `t-line-${speaker}` : ""}`}
              data-line-idx={idx}
              data-ts-ms={ts != null ? String(ts) : undefined}
            >
              {tsLabel != null && (
                <span class="t-timestamp" data-seek-ms={ts != null ? String(ts) : undefined}>
                  {tsLabel}
                </span>
              )}
              {label && <span class={`t-speaker t-speaker-${speaker}`}>[{label}]</span>}
              <span class="t-text">{content}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
