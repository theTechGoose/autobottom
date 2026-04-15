/** Right panel — diarized transcript with speaker labels. */

interface TranscriptPanelProps {
  snippet: string;
  transcript?: string;
}

export function TranscriptPanel({ snippet, transcript }: TranscriptPanelProps) {
  const text = snippet || transcript || "";
  if (!text) {
    return (
      <div class="transcript-panel">
        <div class="transcript-empty">No transcript available</div>
      </div>
    );
  }

  const lines = text.split("\\n").filter(Boolean);

  return (
    <div class="transcript-panel">
      <div class="transcript-header">
        <span class="transcript-title">Transcript</span>
        <span class="transcript-count">{lines.length} lines</span>
      </div>
      <div class="transcript-body">
        {lines.map((line, i) => {
          const isAgent = line.startsWith("[AGENT]");
          const isCustomer = line.startsWith("[CUSTOMER]");
          const speaker = isAgent ? "AGENT" : isCustomer ? "CUSTOMER" : null;
          const content = speaker ? line.replace(/^\[(AGENT|CUSTOMER)\]:?\s*/, "") : line;

          return (
            <div key={i} class={`transcript-line ${isAgent ? "agent" : isCustomer ? "customer" : ""}`}>
              {speaker && <span class={`transcript-speaker ${speaker.toLowerCase()}`}>{speaker}</span>}
              <span class="transcript-text">{content}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
