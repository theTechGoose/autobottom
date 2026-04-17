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
  const text = transcript?.diarized || transcript?.raw || snippet || "";
  if (!text) {
    return (
      <div class="transcript-panel">
        <div class="transcript-empty">No transcript available</div>
      </div>
    );
  }

  const utteranceTimes = transcript?.utteranceTimes ?? [];
  const rawLines = text.split(/\r?\n/);
  const nonEmpty = rawLines.map((l, i) => ({ line: l, srcIdx: i })).filter((x) => x.line.trim().length > 0);

  return (
    <div class="transcript-panel">
      <div class="transcript-header">
        <span class="transcript-title">Transcript</span>
        <span class="transcript-count">{nonEmpty.length} lines</span>
      </div>
      <div class="transcript-body transcript-multicol" id="transcript-body" data-utterance-times={JSON.stringify(utteranceTimes)}>
        {nonEmpty.map(({ line }, idx) => {
          const { speaker, content } = parseLine(line);
          const ts = formatTime(utteranceTimes[idx]);
          const rawTs = utteranceTimes[idx] ?? null;
          const label = speaker === "team" ? "TEAM MEMBER" : speaker === "guest" ? "GUEST" : null;
          return (
            <div
              key={idx}
              class={`t-line ${speaker ? `t-line-${speaker}` : ""}`}
              data-line-idx={idx}
              data-ts-ms={rawTs != null ? String(rawTs) : undefined}
            >
              {ts != null && (
                <span class="t-timestamp" data-seek-ms={rawTs != null ? String(rawTs) : undefined}>
                  {ts}
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
