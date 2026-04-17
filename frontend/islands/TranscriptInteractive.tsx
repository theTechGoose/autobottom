/** Island: hydrates the transcript panel with click-to-seek, evidence
 *  highlighting, defense highlighting, text search (open with `/`, cycle
 *  with `;`), and column-scrolling. The SSR'd TranscriptPanel component
 *  lays down `.t-line` + `.t-timestamp` + `[data-ts-ms]` attrs; this island
 *  attaches behavior without reflowing the DOM.
 *
 *  Mirrors prod main:shared/queue-page.ts transcript interaction block. */
import { useEffect, useRef } from "preact/hooks";

interface Props {
  defense: string | null;
  thinking: string | null;
}

export default function TranscriptInteractive({ defense, thinking }: Props) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const matchCountRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const bodyEl = document.getElementById("transcript-body") as HTMLDivElement | null;
    if (!bodyEl) return;
    const body: HTMLDivElement = bodyEl;

    let matches: HTMLElement[] = [];
    let matchIndex = -1;

    // ── Evidence + defense highlighting ──
    function wordOverlap(line: string, words: string[], min: number): boolean {
      if (!line) return false;
      const lower = line.toLowerCase();
      let hits = 0;
      for (const w of words) {
        if (w.length < 3) continue;
        if (lower.includes(w)) {
          hits++;
          if (hits >= min) return true;
        }
      }
      return false;
    }

    function extractQuotes(source: string): string[] {
      const out: string[] = [];
      const re = /"([^"]{10,})"|"([^"]{10,})"|'([^']{10,})'/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(source))) {
        out.push((m[1] ?? m[2] ?? m[3] ?? "").toLowerCase());
      }
      return out;
    }

    function applyHighlights() {
      const quotes = [
        ...extractQuotes(defense ?? ""),
        ...extractQuotes(thinking ?? ""),
      ];
      const defWords = (defense ?? "").toLowerCase().split(/\W+/).filter((w) => w.length >= 4);

      const lines = Array.from(body.querySelectorAll<HTMLElement>(".t-line"));
      for (const line of lines) {
        line.classList.remove("t-evidence", "t-highlight");
        const text = line.querySelector<HTMLElement>(".t-text")?.textContent ?? "";
        const lowerText = text.toLowerCase();
        const isEvidence = quotes.some((q) => q && (lowerText.includes(q) || q.includes(lowerText.slice(0, 40))));
        if (isEvidence) {
          line.classList.add("t-evidence");
          continue;
        }
        if (wordOverlap(text, defWords, 3)) line.classList.add("t-highlight");
      }
    }

    // ── Click-to-seek on timestamps + anywhere on a line ──
    function onBodyClick(e: Event) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const stampEl = target.closest<HTMLElement>(".t-timestamp");
      const lineEl = target.closest<HTMLElement>(".t-line");
      const ms = stampEl?.dataset.seekMs ?? lineEl?.dataset.tsMs;
      if (!ms) return;
      const n = Number(ms);
      if (!isNaN(n)) {
        document.dispatchEvent(new CustomEvent("queue:jump-to-audio", { detail: { ms: n } }));
      }
    }

    // ── Search ──
    function clearSearchMarks() {
      for (const m of matches) {
        m.classList.remove("t-search-match", "t-search-active");
      }
      matches = [];
      matchIndex = -1;
    }

    function runSearch(query: string) {
      clearSearchMarks();
      if (!query || query.length < 2) {
        if (matchCountRef.current) matchCountRef.current.textContent = "";
        return;
      }
      const q = query.toLowerCase();
      const lines = Array.from(body.querySelectorAll<HTMLElement>(".t-line"));
      for (const line of lines) {
        const text = line.querySelector<HTMLElement>(".t-text")?.textContent?.toLowerCase() ?? "";
        if (text.includes(q)) {
          line.classList.add("t-search-match");
          matches.push(line);
        }
      }
      if (matches.length > 0) {
        matchIndex = 0;
        matches[0].classList.add("t-search-active");
        matches[0].scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
      if (matchCountRef.current) {
        matchCountRef.current.textContent = matches.length > 0 ? `${matchIndex + 1}/${matches.length}` : "0/0";
      }
    }

    function nextMatch() {
      if (matches.length === 0) return;
      matches[matchIndex]?.classList.remove("t-search-active");
      matchIndex = (matchIndex + 1) % matches.length;
      matches[matchIndex].classList.add("t-search-active");
      matches[matchIndex].scrollIntoView({ block: "nearest", behavior: "smooth" });
      if (matchCountRef.current) {
        matchCountRef.current.textContent = `${matchIndex + 1}/${matches.length}`;
      }
    }

    // Open/close the search bar
    function openSearch() {
      const bar = document.getElementById("transcript-search-bar");
      if (!bar) return;
      bar.style.display = "flex";
      setTimeout(() => searchInputRef.current?.focus(), 30);
    }
    function closeSearch() {
      const bar = document.getElementById("transcript-search-bar");
      if (!bar) return;
      bar.style.display = "none";
      clearSearchMarks();
      if (searchInputRef.current) searchInputRef.current.value = "";
      if (matchCountRef.current) matchCountRef.current.textContent = "";
    }

    // ── Column scrolling (multi-column layout) ──
    function scrollByColumn(dir: -1 | 1) {
      if (!body) return;
      // Approximate one column = column-width + column-gap (420 + 24 by our CSS).
      const delta = (420 + 24) * dir;
      body.scrollBy({ left: delta, behavior: "smooth" });
    }

    // Event listeners
    body.addEventListener("click", onBodyClick);
    const onOpen = () => openSearch();
    const onNext = () => nextMatch();
    const onScroll = (e: Event) => {
      const d = (e as CustomEvent).detail as { dir?: 1 | -1 } | undefined;
      scrollByColumn((d?.dir ?? 1) as 1 | -1);
    };
    document.addEventListener("queue:search-open", onOpen);
    document.addEventListener("queue:search-next", onNext);
    document.addEventListener("queue:transcript-scroll", onScroll);

    // Input events for the search field
    const input = searchInputRef.current;
    const onInput = () => input && runSearch(input.value);
    const onSearchKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); closeSearch(); }
      if (e.key === "Enter") { e.preventDefault(); nextMatch(); }
    };
    input?.addEventListener("input", onInput);
    input?.addEventListener("keydown", onSearchKey);

    applyHighlights();

    // Re-apply highlights after HTMX swaps
    const onHtmxSwap = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.target?.id !== "queue-content") return;
      // Body ref may have been replaced entirely — re-run next tick
      setTimeout(() => {
        const newBody = document.getElementById("transcript-body");
        if (!newBody) return;
        // Highlights need the fresh body; we can't access defense/thinking from here
        // post-swap (props won't update) — the swap re-renders server-side, but the
        // island keeps its mounted state. So we read the new verdict DOM for defense.
        const newDefense = (document.querySelector(".verdict-defense-quote")?.textContent ?? "").trim();
        const newThinking = (document.querySelectorAll(".verdict-accordion-body")[0]?.textContent ?? "").trim();
        const quotes = [
          ...extractQuotes(newDefense),
          ...extractQuotes(newThinking),
        ];
        const defWords = newDefense.toLowerCase().split(/\W+/).filter((w) => w.length >= 4);
        const lines = Array.from(newBody.querySelectorAll<HTMLElement>(".t-line"));
        for (const line of lines) {
          line.classList.remove("t-evidence", "t-highlight");
          const text = line.querySelector<HTMLElement>(".t-text")?.textContent ?? "";
          const lowerText = text.toLowerCase();
          const isEvidence = quotes.some((q) => q && (lowerText.includes(q) || q.includes(lowerText.slice(0, 40))));
          if (isEvidence) line.classList.add("t-evidence");
          else if (wordOverlap(text, defWords, 3)) line.classList.add("t-highlight");
        }
      }, 0);
    };
    document.addEventListener("htmx:afterSwap", onHtmxSwap);

    return () => {
      body.removeEventListener("click", onBodyClick);
      document.removeEventListener("queue:search-open", onOpen);
      document.removeEventListener("queue:search-next", onNext);
      document.removeEventListener("queue:transcript-scroll", onScroll);
      document.removeEventListener("htmx:afterSwap", onHtmxSwap);
      input?.removeEventListener("input", onInput);
      input?.removeEventListener("keydown", onSearchKey);
      clearSearchMarks();
    };
  }, [defense, thinking]);

  return (
    <div id="transcript-search-bar" class="transcript-search-bar" style="display:none">
      <input
        ref={searchInputRef}
        type="text"
        placeholder="Search transcript…"
        class="transcript-search-input"
      />
      <span ref={matchCountRef} class="transcript-search-count" />
      <button
        type="button"
        class="transcript-search-btn"
        onClick={() => document.dispatchEvent(new CustomEvent("queue:search-next"))}
      >
        ;
      </button>
      <button
        type="button"
        class="transcript-search-btn"
        onClick={() => {
          const bar = document.getElementById("transcript-search-bar");
          if (bar) bar.style.display = "none";
        }}
      >
        ×
      </button>
    </div>
  );
}
