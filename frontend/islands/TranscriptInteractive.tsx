/** Island: hydrates the transcript panel with click-to-seek, evidence
 *  highlighting, defense highlighting, text search (open with `/` or `\`,
 *  cycle with `;`), and column-scrolling. The SSR'd TranscriptPanel
 *  component lays down `.t-line` + `.t-timestamp` + `[data-ts-ms]` attrs
 *  AND the `#transcript-search-bar` markup; this island attaches behavior
 *  without rendering its own JSX.
 *
 *  CRITICAL: this island MUST be rendered OUTSIDE `#queue-content`. When
 *  HTMX swaps that container (every Y/N decision), any island inside it
 *  unmounts — its useEffect cleanup fires, removing all event listeners,
 *  and the new HTML's island markup never re-hydrates (Gotcha #1 in
 *  frontend/CLAUDE.md). Mounting outside the swap target means this
 *  island stays alive for the page lifetime, and its document-level
 *  listeners keep working through every swap. The `htmx:afterSwap`
 *  handler re-reads defense/thinking from the freshly swapped DOM so
 *  highlights update for the new audit.
 *
 *  Mirrors prod main:shared/queue-page.ts transcript interaction block. */
import { useEffect } from "preact/hooks";

export default function TranscriptInteractive() {
  useEffect(() => {
    let matches: HTMLElement[] = [];
    let matchIndex = -1;

    function getBody(): HTMLDivElement | null {
      return document.getElementById("transcript-body") as HTMLDivElement | null;
    }
    function getSearchBar(): HTMLDivElement | null {
      return document.getElementById("transcript-search-bar") as HTMLDivElement | null;
    }
    function getSearchInput(): HTMLInputElement | null {
      return getSearchBar()?.querySelector(".transcript-search-input") as HTMLInputElement | null;
    }
    function getMatchCount(): HTMLSpanElement | null {
      return getSearchBar()?.querySelector(".transcript-search-count") as HTMLSpanElement | null;
    }

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

    // Normalize smart quotes → ASCII so the regex match is position-consistent.
    function normalize(s: string): string {
      return s
        .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
        .replace(/[\u2018\u2019\u201A\u201B]/g, "'");
    }

    function extractQuotes(sourceRaw: string): string[] {
      const source = normalize(sourceRaw);
      const out: string[] = [];
      const re = /"([^"]{10,})"|'([^']{10,})'/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(source))) {
        out.push((m[1] ?? m[2] ?? "").toLowerCase());
      }
      return out;
    }

    function applyHighlights() {
      const body = getBody();
      if (!body) return;
      // Read defense + thinking from the freshly rendered VerdictPanel DOM
      // rather than from props — this island now lives outside #queue-content
      // and props don't update on HTMX swap. The DOM is the source of truth.
      const defense = (document.querySelector(".verdict-defense-quote")?.textContent ?? "").trim();
      const thinking = (document.querySelectorAll(".verdict-accordion-body")[0]?.textContent ?? "").trim();
      const quotes = [
        ...extractQuotes(defense),
        ...extractQuotes(thinking),
      ];
      const defWords = defense.toLowerCase().split(/\W+/).filter((w) => w.length >= 4);

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
    // Document-level so it survives HTMX swaps of #queue-content.
    function onDocClick(e: Event) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Only act on clicks within the current transcript body.
      if (!target.closest("#transcript-body")) return;
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

    /** Seek audio to the line's start_ms timestamp. Used by both
     *  navigation paths (Enter/`;` next-match and J/K/H/L scroll). */
    function jumpAudioToLine(line: HTMLElement) {
      const tsAttr = line.dataset.tsMs ?? line.querySelector<HTMLElement>(".t-timestamp")?.dataset.seekMs;
      if (!tsAttr) return;
      const n = Number(tsAttr);
      if (!isNaN(n)) {
        document.dispatchEvent(new CustomEvent("queue:jump-to-audio", { detail: { ms: n } }));
      }
    }

    function runSearch(query: string) {
      clearSearchMarks();
      const matchCount = getMatchCount();
      const body = getBody();
      if (!body || !query || query.length < 2) {
        if (matchCount) matchCount.textContent = "";
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
      if (matchCount) {
        matchCount.textContent = matches.length > 0 ? `${matchIndex + 1}/${matches.length}` : "0/0";
      }
    }

    function nextMatch() {
      if (matches.length === 0) return;
      matches[matchIndex]?.classList.remove("t-search-active");
      matchIndex = (matchIndex + 1) % matches.length;
      const target = matches[matchIndex];
      target.classList.add("t-search-active");
      target.scrollIntoView({ block: "nearest", behavior: "smooth" });
      jumpAudioToLine(target);
      const matchCount = getMatchCount();
      if (matchCount) {
        matchCount.textContent = `${matchIndex + 1}/${matches.length}`;
      }
    }

    // Open/close the search bar (re-query each time — DOM may have swapped)
    function openSearch() {
      const bar = getSearchBar();
      if (!bar) return;
      bar.style.display = "flex";
      setTimeout(() => getSearchInput()?.focus(), 30);
    }
    function closeSearch() {
      const bar = getSearchBar();
      if (!bar) return;
      bar.style.display = "none";
      clearSearchMarks();
      const input = getSearchInput();
      if (input) input.value = "";
      const matchCount = getMatchCount();
      if (matchCount) matchCount.textContent = "";
    }

    // ── Column scrolling (multi-column layout) ──
    function scrollByColumn(dir: -1 | 1) {
      const body = getBody();
      if (!body) return;
      // Approximate one column = column-width + column-gap (420 + 24 by our CSS).
      const delta = (420 + 24) * dir;
      body.scrollBy({ left: delta, behavior: "smooth" });
    }

    // All listeners attach at document level so they survive HTMX swaps.
    document.addEventListener("click", onDocClick);
    const onOpen = () => openSearch();
    const onNext = () => nextMatch();
    const onScroll = (e: Event) => {
      const d = (e as CustomEvent).detail as { dir?: 1 | -1 } | undefined;
      scrollByColumn((d?.dir ?? 1) as 1 | -1);
    };
    document.addEventListener("queue:search-open", onOpen);
    document.addEventListener("queue:search-next", onNext);
    document.addEventListener("queue:transcript-scroll", onScroll);

    // Search-field input/keydown — also delegated so they survive swaps.
    function onDocInput(e: Event) {
      const target = e.target as HTMLElement | null;
      if (!target?.classList.contains("transcript-search-input")) return;
      runSearch((target as HTMLInputElement).value);
    }
    function onDocKeydown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (!target?.classList.contains("transcript-search-input")) return;
      if (e.key === "Escape") { e.preventDefault(); closeSearch(); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        // First Enter after typing: jump audio to the FIRST match (the one
        // already activated by runSearch). Subsequent Enters cycle to next.
        const m = matches[matchIndex];
        if (m) jumpAudioToLine(m);
        // Blur so subsequent keypresses don't keep typing into the input.
        (target as HTMLInputElement).blur();
      }
    }
    document.addEventListener("input", onDocInput);
    document.addEventListener("keydown", onDocKeydown);

    applyHighlights();

    // Re-apply highlights after HTMX swaps. The island stays mounted across
    // swaps now (it lives outside #queue-content), so this listener keeps
    // firing for every Y/N decision.
    const onHtmxSwap = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.target?.id !== "queue-content") return;
      // DOM was replaced entirely — re-run on next tick when the new body
      // is in place. clearSearchMarks too, since the old match refs are dead.
      setTimeout(() => {
        clearSearchMarks();
        applyHighlights();
      }, 0);
    };
    document.addEventListener("htmx:afterSwap", onHtmxSwap);

    // Search-bar button delegation. The buttons are SSR'd inside TranscriptPanel
    // (which lives inside #queue-content and gets swapped on every decision),
    // so per-button onClick handlers attached at hydration would die after the
    // first swap. Document-level click delegation against data-search-action
    // works for every swapped-in copy.
    function onSearchBtnClick(e: Event) {
      const target = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-search-action]");
      if (!target) return;
      const action = target.dataset.searchAction;
      if (action === "next") {
        document.dispatchEvent(new CustomEvent("queue:search-next"));
      } else if (action === "close") {
        const bar = document.getElementById("transcript-search-bar");
        if (bar) bar.style.display = "none";
      }
    }
    document.addEventListener("click", onSearchBtnClick);

    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("click", onSearchBtnClick);
      document.removeEventListener("queue:search-open", onOpen);
      document.removeEventListener("queue:search-next", onNext);
      document.removeEventListener("queue:transcript-scroll", onScroll);
      document.removeEventListener("htmx:afterSwap", onHtmxSwap);
      document.removeEventListener("input", onDocInput);
      document.removeEventListener("keydown", onDocKeydown);
      clearSearchMarks();
    };
  }, []);

  // Renders nothing — the search bar markup is SSR'd by TranscriptPanel,
  // and all behavior is delegated at the document level above. Living
  // outside #queue-content keeps the island mounted across HTMX swaps.
  return null;
}
