/**
 * JudgeQueue island — appeal judge queue with keyboard shortcuts,
 * transcript display, audio player, combo meter, and gamification.
 *
 * Fetches from /judge/api/next, submits to /judge/api/decide.
 * Hotkeys: Y=uphold, A=overturn(error), S=overturn(logic), D=overturn(fragment),
 *          F=overturn(transcript), G=toggle reasoning, B=undo, H/L=scroll columns,
 *          P=play/pause, arrows=seek, /=search, ;=next match, ?=cheat sheet.
 */
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";

// ---- Types ----
interface QueueItem {
  findingId: string;
  questionIndex: number;
  header: string;
  populated: string;
  defense: string;
  thinking?: string;
  answer?: string;
  appealType?: string;
  appealComment?: string;
}

interface Transcript {
  diarized?: string;
  raw?: string;
}

interface GameConfig {
  threshold?: number;
  comboTimeoutMs?: number;
  enabled?: boolean;
  sounds?: Record<string, string>;
}

// ---- Constants ----
const LEVEL_THRESHOLDS = [0, 100, 300, 600, 1100, 2000, 3500, 5500, 8000, 12000];
const STREAKS = [
  { at: 2, label: "DOUBLE KILL", cls: "s-double" },
  { at: 3, label: "TRIPLE KILL", cls: "s-triple" },
  { at: 4, label: "MEGA KILL", cls: "s-mega" },
  { at: 5, label: "ULTRA KILL", cls: "s-ultra" },
  { at: 6, label: "RAMPAGE", cls: "s-rampage" },
  { at: 7, label: "GODLIKE", cls: "s-godlike" },
];
const SKIP_TIERS = [1, 5, 10];
const API = "/judge/api";
const STORAGE_PREFIX = "judge";
const APPEAL_LABELS: Record<string, string> = {
  "redo": "Redo",
  "different-recording": "Different Recording",
  "additional-recording": "Additional Recording",
  "upload-recording": "Upload",
};
const REASON_LABELS: Record<string, string> = {
  error: "Error",
  logic: "Logic",
  fragment: "Fragment",
  transcript: "Transcript",
};

// ---- Helpers ----
function getLevel(xp: number): number {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (xp >= LEVEL_THRESHOLDS[i]) return i + 1;
  }
  return 1;
}

function getComboMultiplier(combo: number): number {
  if (combo >= 20) return 3;
  if (combo >= 10) return 2;
  if (combo >= 5) return 1.5;
  return 1;
}

function getComboClass(combo: number): string {
  if (combo <= 0) return "combo-dim";
  if (combo >= 23) return "combo-godlike";
  if (combo >= 12) return "combo-inferno";
  if (combo >= 5) return "combo-fire";
  if (combo >= 3) return "combo-hot";
  return "combo-dim";
}

function isYesAnswer(a: string | undefined): boolean {
  const s = String(a || "").trim().toLowerCase();
  return s.startsWith("yes") || s === "true" || s === "y" || s === "1";
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? "0" : ""}${sec}`;
}

function extractEvidenceSnippets(defense: string, thinking: string): string[] {
  const snippets: string[] = [];
  const combined = (defense || "") + " " + (thinking || "");
  const sq = combined.match(/'([^']{10,})'/g);
  if (sq) sq.forEach((m) => snippets.push(m.slice(1, -1).toLowerCase()));
  const dq = combined.match(/"([^"]{10,})"/g);
  if (dq) dq.forEach((m) => snippets.push(m.slice(1, -1).toLowerCase()));
  return snippets;
}

// ---- Component ----
export default function JudgeQueue() {
  const view = useSignal<"loading" | "review" | "empty">("loading");
  const currentItem = useSignal<QueueItem | null>(null);
  const peekItem = useSignal<QueueItem | null>(null);
  const currentTranscript = useSignal<Transcript | null>(null);
  const auditRemaining = useSignal(0);
  const busy = useSignal(false);
  const pendingDecision = useSignal<string | null>(null);
  const pendingReason = useSignal<string | null>(null);
  const reviewer = useSignal("");
  const thinkingOpen = useSignal(false);
  const cheatOpen = useSignal(false);
  const confirmOpen = useSignal(false);
  const confirmInput = useSignal("");

  // Gamification
  const combo = useSignal(0);
  const comboDropped = useSignal(false);
  const xp = useSignal(0);
  const streakDays = useSignal(0);
  const sessionReviews = useSignal(0);
  const sessionXpGained = useSignal(0);
  const bestCombo = useSignal(0);
  const timeBankVal = useSignal(0);

  // Speed tracking
  const decisionTimes = useRef<number[]>([]);
  const lastDecisionTs = useRef<number | null>(null);
  const totalDecided = useRef(0);
  const totalItems = useRef(0);
  const speedAvg = useSignal("--");

  // Transcript
  const transcriptCache = useRef<Record<string, Transcript>>({});
  const transcriptLines = useSignal<Array<{ cls: string; speaker?: string; content: string }>>([]);
  const colOffset = useRef(0);
  const colStep = useRef(0);
  const totalCols = useRef(1);

  // Search
  const searchOpen = useSignal(false);
  const searchQuery = useSignal("");
  const searchMatchCount = useSignal(0);
  const searchActiveIdx = useSignal(-1);
  const searchMatchEls = useRef<Element[]>([]);

  // Audio
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioPlaying = useSignal(false);
  const audioTime = useSignal("0:00");
  const audioFillPct = useSignal(0);
  const currentRecFinding = useRef<string | null>(null);

  // Skip
  const skipTier = useRef(0);
  const skipLastTs = useRef(0);
  const skipVisible = useSignal(false);
  const skipLabel = useSignal("1s");
  const skipBarPct = useSignal(33);

  // Progress
  const progressPct = useSignal(0);

  // Level/XP display
  const levelNum = useSignal(1);
  const xpBarPct = useSignal(0);
  const xpDisplay = useSignal("0xp");

  // Game config
  const gameConfig = useRef<GameConfig>({ threshold: 0, comboTimeoutMs: 10000, enabled: true });
  const lastReviewTs = useRef(0);
  const timeBankAnimRef = useRef<number | null>(null);

  // Streak banner
  const streakBannerText = useSignal("");
  const streakBannerCls = useSignal("");
  const streakBannerVisible = useSignal(false);

  // Session summary
  const summaryHtml = useSignal("");

  // ---- Toast ----
  const toasts = useSignal<Array<{ id: number; msg: string; type: string }>>([]);
  let toastId = 0;
  function toast(msg: string, type = "info") {
    const id = ++toastId;
    toasts.value = [...toasts.value, { id, msg, type }];
    setTimeout(() => { toasts.value = toasts.value.filter((t) => t.id !== id); }, 1400);
  }

  // ---- Game state ----
  function getGameState() {
    try { return JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}_game_${reviewer.value}`) || "{}"); } catch { return {}; }
  }
  function saveGameState(patch: Record<string, unknown>) {
    const state = { ...getGameState(), ...patch };
    localStorage.setItem(`${STORAGE_PREFIX}_game_${reviewer.value}`, JSON.stringify(state));
  }
  function loadGameState() {
    const state = getGameState();
    xp.value = state.xp || 0;
    streakDays.value = state.streakDays || 0;
    combo.value = 0;
    sessionReviews.value = 0;
    sessionXpGained.value = 0;
    bestCombo.value = 0;
    lastReviewTs.current = 0;
    updateLevelDisplay(state.xp || 0);
  }

  function updateLevelDisplay(xpVal: number) {
    const level = getLevel(xpVal);
    const cur = LEVEL_THRESHOLDS[level - 1] || 0;
    const next = LEVEL_THRESHOLDS[level] ?? LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
    const pct = next > cur ? ((xpVal - cur) / (next - cur)) * 100 : 100;
    levelNum.value = level;
    xpBarPct.value = pct;
    xpDisplay.value = `${xpVal.toLocaleString()}xp`;
  }

  function awardXp(base: number) {
    const state = getGameState();
    const oldXp = state.xp || 0;
    const oldLevel = getLevel(oldXp);
    const mult = getComboMultiplier(combo.value);
    const gained = Math.round(base * mult);
    const newXp = oldXp + gained;
    const newLevel = getLevel(newXp);
    saveGameState({ xp: newXp });
    xp.value = newXp;
    sessionXpGained.value = sessionXpGained.value + gained;
    updateLevelDisplay(newXp);
    if (newLevel > oldLevel) toast(`Level ${newLevel}`, "combo");
  }

  function updateStreak() {
    const state = getGameState();
    const today = new Date().toISOString().slice(0, 10);
    const todayCount = state.todayDate === today ? (state.todayCount || 0) + 1 : 1;
    let days = state.streakDays || 0;
    let lastStreakDate = state.lastStreakDate || "";
    if (todayCount >= 5 && lastStreakDate !== today) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      days = lastStreakDate === yesterday ? days + 1 : 1;
      lastStreakDate = today;
    }
    saveGameState({ todayDate: today, todayCount, streakDays: days, lastStreakDate });
    streakDays.value = days;
  }

  function showStreakBanner(streak: { label: string; cls: string }) {
    streakBannerText.value = streak.label;
    streakBannerCls.value = streak.cls;
    streakBannerVisible.value = true;
    setTimeout(() => { streakBannerVisible.value = false; }, 1300);
  }

  function tickCombo() {
    const now = Date.now();
    const cfg = gameConfig.current;
    const STREAK_THRESHOLD = cfg.threshold || 0;
    const COMBO_TIMEOUT = cfg.comboTimeoutMs || 10000;

    if (STREAK_THRESHOLD > 0) {
      let bank = timeBankVal.value;
      if (!lastReviewTs.current) {
        bank = STREAK_THRESHOLD;
      } else {
        const elapsed = (now - lastReviewTs.current) / 1000;
        bank = bank - elapsed + STREAK_THRESHOLD;
        if (bank < 0) { if (combo.value > 0) comboDropped.value = true; combo.value = 0; bank = 0; }
      }
      timeBankVal.value = bank;
    } else {
      if (lastReviewTs.current && (now - lastReviewTs.current) > COMBO_TIMEOUT) {
        if (combo.value > 0) comboDropped.value = true;
        combo.value = 0;
      }
    }

    combo.value = combo.value + 1;

    if (combo.value === 1 && comboDropped.value) {
      comboDropped.value = false;
      lastReviewTs.current = now;
      if (combo.value > bestCombo.value) bestCombo.value = combo.value;
      startTimeBankDrain();
      return;
    }

    lastReviewTs.current = now;
    if (combo.value > bestCombo.value) bestCombo.value = combo.value;
    startTimeBankDrain();

    const maxStreak = STREAKS[STREAKS.length - 1];
    if (combo.value > maxStreak.at) { showStreakBanner(maxStreak); return; }
    const matched = STREAKS.find((s) => s.at === combo.value);
    if (matched) showStreakBanner(matched);
  }

  function resetCombo() {
    if (combo.value > 0) comboDropped.value = true;
    combo.value = 0;
    timeBankVal.value = 0;
    if (timeBankAnimRef.current) { cancelAnimationFrame(timeBankAnimRef.current); timeBankAnimRef.current = null; }
  }

  function startTimeBankDrain() {
    const cfg = gameConfig.current;
    if (!cfg.threshold || cfg.threshold <= 0 || combo.value <= 0) return;
    if (timeBankAnimRef.current) cancelAnimationFrame(timeBankAnimRef.current);
    let lastFrame = performance.now();
    function drain(now: number) {
      const dt = (now - lastFrame) / 1000;
      lastFrame = now;
      timeBankVal.value = Math.max(0, timeBankVal.value - dt);
      if (timeBankVal.value <= 0) { combo.value = 0; return; }
      timeBankAnimRef.current = requestAnimationFrame(drain);
    }
    timeBankAnimRef.current = requestAnimationFrame(drain);
  }

  function updateProgress(remaining: number) {
    const total = totalItems.current || (totalDecided.current + remaining);
    if (total <= 0) return;
    progressPct.value = Math.min(100, (totalDecided.current / total) * 100);
  }

  function trackDecision() {
    const now = Date.now();
    if (lastDecisionTs.current) {
      const elapsed = (now - lastDecisionTs.current) / 1000;
      decisionTimes.current.push(elapsed);
      if (decisionTimes.current.length > 20) decisionTimes.current.shift();
      const avg = decisionTimes.current.reduce((a, b) => a + b, 0) / decisionTimes.current.length;
      speedAvg.value = avg.toFixed(1);
    }
    lastDecisionTs.current = now;
    totalDecided.current++;
  }

  function buildTranscriptLines(item: QueueItem | null, tr: Transcript | null) {
    if (!tr || (!tr.diarized && !tr.raw)) {
      transcriptLines.value = [{ cls: "t-empty", content: "No transcript available" }];
      return;
    }
    const text = tr.diarized || tr.raw || "";
    const defLow = ((item?.defense) || "").toLowerCase();
    const snippets = extractEvidenceSnippets(item?.defense || "", item?.thinking || "");
    const lines = text.split("\n");
    const result: Array<{ cls: string; speaker?: string; content: string }> = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      const match = line.match(/^\[?(AGENT|CUSTOMER|SYSTEM|Agent|Customer|System)\]?[:\s]*(.*)/i);
      if (match) {
        const speaker = match[1].toUpperCase();
        const content = match[2] || "";
        const contentLow = content.toLowerCase();
        let cls = "t-line";
        cls += speaker === "AGENT" ? " t-agent" : speaker === "CUSTOMER" ? " t-customer" : " t-system";

        let isEvidence = false;
        if (snippets.length > 0 && content.length > 10) {
          for (const snip of snippets) {
            if (contentLow.includes(snip) || snip.includes(contentLow.slice(0, 40))) {
              isEvidence = true;
              break;
            }
          }
        }
        if (isEvidence) {
          cls += " t-evidence";
        } else if (defLow && content.length > 20) {
          const words = defLow.split(/\s+/).filter((w) => w.length > 5);
          if (words.filter((w) => contentLow.includes(w)).length >= 3) cls += " t-highlight";
        }
        result.push({ cls, speaker, content });
      } else {
        result.push({ cls: "t-line", content: line });
      }
    }
    transcriptLines.value = result;
  }

  function loadRecording(findingId: string) {
    const audio = audioRef.current;
    if (!audio || !findingId || findingId === currentRecFinding.current) return;
    currentRecFinding.current = findingId;
    audio.src = `/audit/recording?id=${encodeURIComponent(findingId)}`;
    audio.load();
    audioFillPct.value = 0;
    audioTime.value = "0:00";
    audioPlaying.value = false;
  }

  function skipSeek(dir: number) {
    const audio = audioRef.current;
    if (!audio) return;
    const now = Date.now();
    const elapsed = now - skipLastTs.current;
    skipLastTs.current = now;
    if (elapsed < 1000 && skipTier.current < SKIP_TIERS.length - 1) skipTier.current++;
    else if (elapsed >= 1000) skipTier.current = 0;
    const amount = SKIP_TIERS[skipTier.current];
    audio.currentTime = dir > 0
      ? Math.min(audio.duration || 0, audio.currentTime + amount)
      : Math.max(0, audio.currentTime - amount);
    skipLabel.value = `${amount}s`;
    skipBarPct.value = ((skipTier.current + 1) / SKIP_TIERS.length) * 100;
    skipVisible.value = true;
  }

  // ---- Decide ----
  function decide(decision: string, reason?: string) {
    if (!currentItem.value || busy.value) return;
    if (auditRemaining.value === 1) {
      pendingDecision.value = decision;
      pendingReason.value = reason || null;
      confirmInput.value = "";
      confirmOpen.value = true;
      return;
    }
    executeDecision(decision, reason);
  }

  async function executeDecision(decision: string, reason?: string) {
    const item = currentItem.value;
    if (!item || busy.value) return;
    busy.value = true;

    trackDecision();
    tickCombo();
    sessionReviews.value = sessionReviews.value + 1;
    awardXp(decision === "uphold" ? 10 : 15);
    updateStreak();

    let didSwap = false;
    if (peekItem.value) {
      didSwap = true;
      const next = peekItem.value;
      currentItem.value = next;
      peekItem.value = null;
      const cached = transcriptCache.current[next.findingId];
      if (cached) currentTranscript.value = cached;
      buildTranscriptLines(next, cached || null);
      loadRecording(next.findingId);
    }

    const label = decision === "uphold"
      ? "Upheld"
      : `Overturned: ${REASON_LABELS[reason || ""] || reason}`;
    toast(label, decision === "uphold" ? "uphold" : "overturn");

    const body: Record<string, unknown> = {
      findingId: item.findingId,
      questionIndex: item.questionIndex,
      decision,
      combo: combo.value,
      level: getLevel(sessionXpGained.value),
    };
    if (reason) body.reason = reason;

    try {
      const res = await fetch(`${API}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.status === 409) { busy.value = false; return; }
      if (!res.ok) throw new Error(data.error || "Request failed");

      if (data.appealComplete) toast("Appeal complete", "complete");

      const remaining = data.next?.remaining ?? 0;
      updateProgress(remaining);

      if (data.next?.current) {
        auditRemaining.value = data.next.auditRemaining || 0;
        if (didSwap) {
          peekItem.value = data.next.peek || null;
        } else {
          currentItem.value = data.next.current;
          peekItem.value = data.next.peek || null;
          currentTranscript.value = data.next.transcript || null;
          if (data.next.transcript && data.next.current) {
            transcriptCache.current[data.next.current.findingId] = data.next.transcript;
          }
          buildTranscriptLines(data.next.current, data.next.transcript || null);
          loadRecording(data.next.current.findingId);
        }
        if (data.next.transcript && data.next.current) {
          transcriptCache.current[data.next.current.findingId] = data.next.transcript;
        }
      } else if (!didSwap) {
        view.value = "empty";
        buildSessionSummary();
      } else {
        peekItem.value = null;
      }
    } catch (err: unknown) {
      toast((err as Error).message, "error");
    }
    busy.value = false;
  }

  function buildSessionSummary() {
    const reviews = sessionReviews.value;
    if (reviews === 0) { summaryHtml.value = ""; return; }
    const times = decisionTimes.current;
    const avgTime = times.length > 0
      ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1) : "--";
    summaryHtml.value = `${reviews} reviews / ${bestCombo.value}x best combo / avg ${avgTime}s / +${sessionXpGained.value} XP`;
  }

  async function goBack() {
    if (busy.value) return;
    busy.value = true;
    try {
      const res = await fetch(`${API}/back`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Back failed");
      currentItem.value = data.current;
      currentTranscript.value = data.transcript || null;
      peekItem.value = data.peek || null;
      auditRemaining.value = data.auditRemaining || 0;
      if (data.transcript && data.current) {
        transcriptCache.current[data.current.findingId] = data.transcript;
      }
      buildTranscriptLines(data.current, data.transcript || null);
      loadRecording(data.current?.findingId);
      view.value = "review";
      toast("Undid last decision", "undo");
      resetCombo();
      totalDecided.current = Math.max(0, totalDecided.current - 1);
      updateProgress(data.remaining || 0);
    } catch (err: unknown) {
      toast((err as Error).message, "error");
    }
    busy.value = false;
  }

  // ---- Keyboard ----
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (confirmOpen.value) return;

      if (e.key === "?") { e.preventDefault(); cheatOpen.value = !cheatOpen.value; return; }
      if (e.key === "/") { e.preventDefault(); searchOpen.value = true; return; }
      if (e.key === ";") {
        e.preventDefault();
        if (searchMatchEls.current.length > 0) {
          const next = (searchActiveIdx.value < 0 ? 0 : searchActiveIdx.value + 1) % searchMatchEls.current.length;
          activateSearchMatch(next);
        }
        return;
      }

      switch (e.key.toLowerCase()) {
        case "y": decide("uphold"); break;
        case "a": decide("overturn", "error"); break;
        case "s": decide("overturn", "logic"); break;
        case "d": decide("overturn", "fragment"); break;
        case "f": decide("overturn", "transcript"); break;
        case "g": thinkingOpen.value = !thinkingOpen.value; break;
        case "b":
        case "backspace": e.preventDefault(); goBack(); break;
        case "l": scrollColumns(1); break;
        case "h": scrollColumns(-1); break;
        case "p": {
          const audio = audioRef.current;
          if (audio) { if (audio.paused) audio.play(); else audio.pause(); }
          break;
        }
        case "arrowleft": e.preventDefault(); skipSeek(-1); break;
        case "arrowright": e.preventDefault(); skipSeek(1); break;
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  function scrollColumns(dir: number) {
    const body = document.getElementById("transcript-body-judge");
    if (!body) return;
    const maxOffset = Math.max(0, totalCols.current - 3);
    colOffset.current = Math.max(0, Math.min(colOffset.current + dir, maxOffset));
    body.scrollTo({ left: colOffset.current * colStep.current, behavior: "smooth" });
  }

  function runSearch(q: string) {
    const lines = document.querySelectorAll("#transcript-body-judge .t-line");
    lines.forEach((el) => el.classList.remove("t-search-match", "t-search-active"));
    searchMatchEls.current = [];
    searchActiveIdx.value = -1;
    if (!q.trim()) { searchMatchCount.value = 0; return; }
    const lq = q.trim().toLowerCase();
    const matches: Element[] = [];
    lines.forEach((el) => {
      if (el.textContent?.toLowerCase().includes(lq)) { el.classList.add("t-search-match"); matches.push(el); }
    });
    searchMatchEls.current = matches;
    searchMatchCount.value = matches.length;
  }

  function activateSearchMatch(idx: number) {
    const matches = searchMatchEls.current;
    if (matches.length === 0) return;
    const wrapped = ((idx % matches.length) + matches.length) % matches.length;
    document.querySelector(".t-search-active")?.classList.remove("t-search-active");
    const el = matches[wrapped];
    el.classList.add("t-search-active");
    searchActiveIdx.value = wrapped;
    searchMatchCount.value = matches.length;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // ---- Init ----
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/next`);
        if (!res.ok) { window.location.href = "/login"; return; }
        const data = await res.json();
        reviewer.value = data.reviewer || "judge";
        loadGameState();

        try {
          const gcRes = await fetch(`${API}/gamification`);
          if (gcRes.ok) { const gc = await gcRes.json(); gameConfig.current = gc.resolved || gameConfig.current; }
        } catch { /* ignore */ }

        try {
          const statsRes = await fetch(`${API}/stats`);
          if (statsRes.ok) {
            const stats = await statsRes.json();
            totalItems.current = (stats.pending || 0) + (stats.decided || 0);
            totalDecided.current = stats.decided || 0;
            updateProgress(stats.pending || 0);
          }
        } catch { /* ignore */ }

        if (data.current) {
          currentItem.value = data.current;
          peekItem.value = data.peek || null;
          currentTranscript.value = data.transcript || null;
          auditRemaining.value = data.auditRemaining || 0;
          if (data.transcript && data.current) {
            transcriptCache.current[data.current.findingId] = data.transcript;
          }
          buildTranscriptLines(data.current, data.transcript || null);
          loadRecording(data.current.findingId);
          view.value = "review";
        } else {
          view.value = "empty";
        }

        const emailEl = document.getElementById("user-email");
        const avatarEl = document.getElementById("user-avatar");
        if (emailEl) emailEl.textContent = data.reviewer || "";
        if (avatarEl) avatarEl.textContent = (data.reviewer || "?")[0].toUpperCase();
      } catch {
        window.location.href = "/login";
      }
    })();
  }, []);

  const cfg = gameConfig.current;
  const STREAK_THRESHOLD = cfg.threshold || 0;
  const bankMax = STREAK_THRESHOLD * 3;
  const bankPct = bankMax > 0 ? Math.min(100, (timeBankVal.value / bankMax) * 100) : 0;
  const bankCls = timeBankVal.value > STREAK_THRESHOLD * 2 ? "tb-green"
    : timeBankVal.value > STREAK_THRESHOLD * 0.5 ? "tb-yellow" : "tb-red";

  const item = currentItem.value;
  const isYes = item ? isYesAnswer(item.answer) : false;
  const verdictBadgeBg = isYes ? "rgba(63,185,80,0.12)" : "rgba(248,81,73,0.12)";
  const verdictBadgeColor = isYes ? "#3fb950" : "#f85149";
  const verdictBadgeBorder = isYes ? "1px solid rgba(63,185,80,0.2)" : "1px solid rgba(248,81,73,0.2)";

  return (
    <div style={{ position: "fixed", inset: "0", zIndex: "50", background: "#0a0e14" }}>
      <style>{JUDGE_QUEUE_CSS}</style>

      {streakBannerVisible.value && (
        <div class={`streak-banner ${streakBannerCls.value}`}>{streakBannerText.value}</div>
      )}

      {/* Progress bar */}
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: "3px", background: "#1a1f2b", zIndex: 100 }}>
        <div style={{ height: "100%", background: "linear-gradient(90deg,#0d9488,#14b8a6)", width: `${progressPct.value}%`, transition: "width 0.4s ease" }} />
      </div>

      {/* Review screen */}
      {view.value === "review" && item && (
        <div style={{ display: "grid", height: "100vh", gridTemplateColumns: "380px 1fr", gridTemplateRows: "3px 1fr 44px", overflow: "hidden" }}>
          {/* Left panel */}
          <div style={{ gridColumn: "1", gridRow: "2", display: "flex", flexDirection: "column", background: "#0f1219", borderRight: "1px solid #1a1f2b", overflowY: "auto" }}>
            <div style={{ padding: "24px 20px" }}>
              <div style={{ fontSize: "10px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "1.5px", color: "#6e7681", marginBottom: "8px" }}>Question</div>
              <div style={{ fontSize: "20px", fontWeight: "700", color: "#e6edf3", lineHeight: "1.3", marginBottom: "10px" }}>{item.header}</div>

              {/* Dynamic verdict badge */}
              <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "5px 12px", borderRadius: "20px", fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "20px", background: verdictBadgeBg, color: verdictBadgeColor, border: verdictBadgeBorder }}>
                <span style={{ display: "block", width: "6px", height: "6px", borderRadius: "50%", background: verdictBadgeColor }} />
                Current Answer: {isYes ? "YES" : "NO"}
              </div>

              {/* Appeal info (judge-specific) */}
              {item.appealType && (
                <div style={{ marginBottom: "14px" }}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 10px", borderRadius: "6px", fontSize: "10px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.8px", background: "rgba(251,191,36,0.1)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.2)" }}>
                    Appeal: {APPEAL_LABELS[item.appealType] || item.appealType}
                  </div>
                  {item.appealComment && (
                    <div style={{ marginTop: "8px", padding: "8px 12px", borderRadius: "6px", fontSize: "12px", lineHeight: "1.5", background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.12)", color: "#d4c48a" }}>
                      <div style={{ fontSize: "9px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "1px", color: "#fbbf24", marginBottom: "4px" }}>Agent Comment</div>
                      {item.appealComment}
                    </div>
                  )}
                </div>
              )}

              <div style={{ fontSize: "14px", lineHeight: "1.6", color: "#9ca3af", marginBottom: "20px" }}>{item.populated}</div>

              <div style={{ marginBottom: "16px" }}>
                <div style={{ fontSize: "10px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "1.2px", color: "#14b8a6", marginBottom: "8px" }}>Defense</div>
                <div style={{ fontSize: "13px", lineHeight: "1.65", color: "#b0b8c4", padding: "12px 14px", background: "#141820", borderRadius: "10px", border: "1px solid #1a1f2b" }}>
                  {item.defense || "No defense provided"}
                </div>
              </div>

              <button
                style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#6e7681", cursor: "pointer", padding: "8px 0", border: "none", background: "none", width: "100%" }}
                onClick={() => { thinkingOpen.value = !thinkingOpen.value; }}
              >
                <span style={{ transition: "transform 0.2s", display: "inline-block", transform: thinkingOpen.value ? "rotate(90deg)" : "none", fontSize: "9px" }}>&#9654;</span>
                <span>Bot reasoning</span>
                <span style={{ marginLeft: "auto", fontSize: "10px", color: "#3d4452" }}>
                  <kbd style={{ background: "#141820", border: "1px solid #1e2736", borderRadius: "3px", padding: "0 4px", fontFamily: "monospace", fontSize: "10px", color: "#6e7681" }}>G</kbd>
                </span>
              </button>
              {thinkingOpen.value && (
                <div style={{ fontSize: "13px", lineHeight: "1.6", color: "#8b949e", padding: "10px 14px", background: "#141820", borderRadius: "10px", border: "1px solid #1a1f2b", fontStyle: "italic", marginBottom: "12px" }}>
                  {item.thinking || "No reasoning provided"}
                </div>
              )}

              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px", paddingTop: "16px", borderTop: "1px solid #1a1f2b" }}>
                <div class="meta-chip">Appeal <strong>{item.findingId}</strong></div>
                <div class="meta-chip">Q<strong>{item.questionIndex}</strong></div>
                <div class="meta-chip">Left <strong>{peekItem.value ? "..." : "0"}</strong></div>
                {auditRemaining.value === 1 && <div class="meta-chip last-item"><strong>Final for appeal</strong></div>}
              </div>

              {/* Judge decision buttons */}
              <div style={{ marginTop: "20px", paddingTop: "16px", borderTop: "1px solid #1a1f2b" }}>
                <button class="judge-btn uphold" onClick={() => decide("uphold")}>
                  <kbd>Y</kbd> Uphold
                </button>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginTop: "8px" }}>
                  {[
                    { key: "A", label: "Error", reason: "error" },
                    { key: "S", label: "Logic", reason: "logic" },
                    { key: "D", label: "Fragment", reason: "fragment" },
                    { key: "F", label: "Transcript", reason: "transcript" },
                  ].map(({ key, label, reason }) => (
                    <button key={key} class="judge-btn overturn" onClick={() => decide("overturn", reason)}>
                      <kbd>{key}</kbd> {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Right: Transcript */}
          <div style={{ gridColumn: "2", gridRow: "2", padding: "20px 24px", overflow: "hidden", minHeight: "0", position: "relative" }}>
            {searchOpen.value && (
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 20, display: "flex", alignItems: "center", gap: "8px", padding: "8px 16px", background: "rgba(15,18,25,0.95)", backdropFilter: "blur(8px)", borderBottom: "1px solid #1e2736" }}>
                <input
                  type="text"
                  placeholder="Search transcript..."
                  autoComplete="off"
                  value={searchQuery.value}
                  style={{ flex: "1", background: "#0a0e14", border: "1px solid #1e2736", borderRadius: "6px", padding: "6px 10px", color: "#c9d1d9", fontSize: "13px", outline: "none" }}
                  onInput={(e) => {
                    searchQuery.value = (e.target as HTMLInputElement).value;
                    runSearch(searchQuery.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && searchMatchEls.current.length > 0) {
                      activateSearchMatch(searchActiveIdx.value < 0 ? 0 : searchActiveIdx.value + 1);
                    } else if (e.key === "Escape") {
                      searchOpen.value = false; searchQuery.value = ""; searchMatchCount.value = 0;
                    } else if (e.key === ";") {
                      e.preventDefault();
                      activateSearchMatch(searchActiveIdx.value < 0 ? 0 : searchActiveIdx.value + 1);
                    }
                    e.stopPropagation();
                  }}
                />
                <span style={{ fontSize: "11px", color: "#484f58", whiteSpace: "nowrap" }}>
                  {searchMatchCount.value > 0
                    ? searchActiveIdx.value >= 0 ? `${searchActiveIdx.value + 1}/${searchMatchCount.value}` : `${searchMatchCount.value} found`
                    : searchQuery.value ? "no match" : ""}
                </span>
                <button
                  style={{ background: "none", border: "none", color: "#484f58", cursor: "pointer", fontSize: "14px", padding: "2px 6px" }}
                  onClick={() => { searchOpen.value = false; searchQuery.value = ""; searchMatchCount.value = 0; }}
                >&times;</button>
              </div>
            )}

            <div id="transcript-body-judge" style={{ columnGap: "24px", columnFill: "auto", overflowX: "scroll", overflowY: "hidden", scrollbarWidth: "none" }}>
              {transcriptLines.value.map((line, i) => (
                <div key={i} class={line.cls}>
                  {line.speaker && <span class="t-speaker">{line.speaker}</span>}
                  {line.content}
                </div>
              ))}
            </div>
          </div>

          {/* Cheat sheet */}
          {cheatOpen.value && (
            <div style={{ display: "flex", gap: "20px", position: "fixed", bottom: "52px", left: "24px", zIndex: "2500", background: "#12161e", border: "1px solid #1e2736", borderRadius: "12px", padding: "16px 20px", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: "130px" }}>
                <div style={{ fontSize: "9px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "1px", color: "#3d4452", marginBottom: "2px", paddingBottom: "4px", borderBottom: "1px solid #1a1f2b" }}>Decide</div>
                {[
                  { key: "Y", label: "Uphold", pos: true },
                  { key: "A", label: "Error", pos: false },
                  { key: "S", label: "Logic", pos: false },
                  { key: "D", label: "Fragment", pos: false },
                  { key: "F", label: "Transcript", pos: false },
                ].map(({ key, label, pos }) => (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#6e7681", padding: "2px 0" }}>
                    <kbd style={{ background: "#141820", border: `1px solid ${pos ? "rgba(20,184,166,0.4)" : "rgba(248,81,73,0.3)"}`, borderRadius: "4px", padding: "0 5px", color: pos ? "#14b8a6" : "#f85149", fontFamily: "monospace", fontSize: "10px" }}>{key}</kbd>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: "130px" }}>
                <div style={{ fontSize: "9px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "1px", color: "#3d4452", marginBottom: "2px", paddingBottom: "4px", borderBottom: "1px solid #1a1f2b" }}>Navigate</div>
                {[["B", "Undo"], ["G", "Toggle reasoning"], ["H L", "Scroll cols"]].map(([key, label]) => (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#6e7681" }}>
                    <kbd style={{ background: "#141820", border: "1px solid #1e2736", borderRadius: "4px", padding: "0 5px", fontFamily: "monospace", fontSize: "10px", color: "#8b949e" }}>{key}</kbd>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bottom bar */}
          <div style={{ gridColumn: "1/-1", gridRow: "3", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px", background: "#0f1219", borderTop: "1px solid #1a1f2b", height: "44px" }}>
            <button
              style={{ display: "inline-flex", alignItems: "center", gap: "5px", background: "none", border: "1px solid #1e2736", borderRadius: "6px", padding: "3px 8px", color: "#3d4452", fontSize: "10px", cursor: "pointer" }}
              onClick={() => { cheatOpen.value = !cheatOpen.value; }}
            >
              <kbd style={{ background: "#141820", border: "1px solid #1e2736", borderRadius: "3px", padding: "0 4px", fontFamily: "monospace", fontSize: "10px", color: "#6e7681" }}>?</kbd> Keys
            </button>

            {/* Audio player */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <audio
                ref={audioRef}
                preload="none"
                style={{ display: "none" }}
                onPlay={() => { audioPlaying.value = true; }}
                onPause={() => { audioPlaying.value = false; }}
                onEnded={() => { audioPlaying.value = false; }}
                onTimeUpdate={() => {
                  const a = audioRef.current;
                  if (!a) return;
                  audioTime.value = `${fmtTime(a.currentTime)}/${fmtTime(a.duration || 0)}`;
                  if (a.duration) audioFillPct.value = (a.currentTime / a.duration) * 100;
                }}
              />
              <button
                style={{ width: "22px", height: "22px", borderRadius: "50%", border: "none", cursor: "pointer", background: "#0d9488", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", padding: "0" }}
                onClick={() => { const a = audioRef.current; if (a) { if (a.paused) a.play(); else a.pause(); } }}
              >
                {audioPlaying.value
                  ? <svg width="9" height="9" fill="#fff"><rect x="0" y="0" width="3" height="9" /><rect x="5" y="0" width="3" height="9" /></svg>
                  : <svg width="9" height="9" fill="#fff"><polygon points="1,0 8,4.5 1,9" /></svg>}
              </button>
              <button
                style={{ background: "#141820", border: "1px solid #1e2736", borderRadius: "4px", color: "#6e7681", cursor: "pointer", fontSize: "10px", padding: "2px 6px", fontFamily: "monospace" }}
                onClick={() => { const a = audioRef.current; if (a) a.currentTime = Math.max(0, a.currentTime - 5); }}
              >&larr;5s</button>
              <div
                style={{ width: "140px", height: "4px", background: "#1a1f2b", borderRadius: "2px", cursor: "pointer" }}
                onClick={(e) => {
                  const a = audioRef.current;
                  if (!a) return;
                  const rect = (e.target as HTMLElement).getBoundingClientRect();
                  if (a.duration) a.currentTime = ((e.clientX - rect.left) / rect.width) * a.duration;
                }}
              >
                <div style={{ height: "100%", background: "#14b8a6", borderRadius: "2px", width: `${audioFillPct.value}%`, pointerEvents: "none" }} />
              </div>
              <button
                style={{ background: "#141820", border: "1px solid #1e2736", borderRadius: "4px", color: "#6e7681", cursor: "pointer", fontSize: "10px", padding: "2px 6px", fontFamily: "monospace" }}
                onClick={() => { const a = audioRef.current; if (a) a.currentTime = Math.min(a.duration || 0, a.currentTime + 5); }}
              >5s&rarr;</button>
              <span style={{ fontFamily: "monospace", fontSize: "9px", color: "#3d4452", whiteSpace: "nowrap" }}>{audioTime.value}</span>
              {skipVisible.value && (
                <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                  <span style={{ fontFamily: "monospace", fontSize: "9px", fontWeight: "700", color: "#14b8a6" }}>{skipLabel.value}</span>
                  <div style={{ width: "36px", height: "4px", background: "#1a1f2b", borderRadius: "2px", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${skipBarPct.value}%`, background: "linear-gradient(90deg,#0d9488,#14b8a6)", borderRadius: "2px" }} />
                  </div>
                </div>
              )}
            </div>

            {/* Center */}
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <span class={`combo-counter ${getComboClass(combo.value)}`} style={{ fontSize: "12px", fontWeight: "800", minWidth: "28px", textAlign: "center", letterSpacing: "-0.5px" }}>
                {combo.value > 0 ? `${combo.value}x` : ""}
              </span>
              {STREAK_THRESHOLD > 0 && (
                <div style={{ height: "3px", width: "40px", background: "#1a1f2b", borderRadius: "2px", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${bankPct}%`, background: bankCls === "tb-green" ? "#3fb950" : bankCls === "tb-yellow" ? "#d29922" : "#f85149", transition: "width 0.3s linear" }} />
                </div>
              )}
              <div style={{ fontSize: "11px", color: "#3d4452" }}>avg <strong style={{ color: "#6e7681" }}>{speedAvg.value}</strong>s</div>
              <span style={{ fontSize: "11px", color: "#3d4452" }}>{sessionReviews.value} today</span>
            </div>

            {/* Right */}
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <span style={{ fontSize: "11px", fontWeight: "600", color: "#6e7681" }}>
                Lv.{levelNum.value}
                <span style={{ display: "inline-block", width: "40px", height: "3px", background: "#1a1f2b", borderRadius: "2px", overflow: "hidden", verticalAlign: "middle", margin: "0 4px" }}>
                  <span style={{ display: "block", height: "100%", background: "linear-gradient(90deg,#0d9488,#14b8a6)", borderRadius: "2px", width: `${xpBarPct.value}%` }} />
                </span>
                <span style={{ fontSize: "10px", color: "#484f58" }}>{xpDisplay.value}</span>
              </span>
              {streakDays.value > 0 && <span style={{ fontSize: "11px", fontWeight: "600", color: "#fab005" }}>{streakDays.value}d</span>}
              <a href="/judge/dashboard" style={{ background: "none", border: "1px solid #1e2736", borderRadius: "6px", padding: "3px 10px", color: "#6e7681", fontSize: "10px", textDecoration: "none", textTransform: "uppercase" }}>Dashboard</a>
              <button
                style={{ background: "none", border: "1px solid #1e2736", borderRadius: "6px", padding: "3px 10px", color: "#6e7681", fontSize: "10px", cursor: "pointer" }}
                onClick={() => { window.location.href = "/login"; }}
              >Logout</button>
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {view.value === "empty" && (
        <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
          <div>
            <h2 style={{ color: "#e6edf3", marginBottom: "8px", fontSize: "22px" }}>All caught up</h2>
            {summaryHtml.value
              ? <p style={{ color: "#8b949e", fontSize: "14px" }}>{summaryHtml.value}</p>
              : <p style={{ color: "#484f58", fontSize: "15px" }}>No items pending judge review. Check back later.</p>
            }
          </div>
        </div>
      )}

      {/* Loading state */}
      {view.value === "loading" && (
        <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#484f58", fontSize: "13px" }}>
          Loading...
        </div>
      )}

      {/* Confirmation modal */}
      {confirmOpen.value && (
        <div
          style={{ position: "fixed", inset: "0", zIndex: "3000", background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={(e) => { if (e.target === e.currentTarget) { confirmOpen.value = false; pendingDecision.value = null; } }}
        >
          <div style={{ background: "#12161e", border: "1px solid #1e2736", borderRadius: "16px", padding: "32px 36px", width: "400px", boxShadow: "0 8px 40px rgba(0,0,0,0.5)" }}>
            <h3 style={{ color: "#e6edf3", fontSize: "17px", fontWeight: "700", marginBottom: "8px" }}>Final Question for This Appeal</h3>
            <p style={{ color: "#8b949e", fontSize: "13px", lineHeight: "1.5", marginBottom: "20px" }}>This is the last item for this appeal. Submitting will finalize the judgment.</p>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: "700", marginBottom: "16px", background: "rgba(20,184,166,0.1)", border: "1px solid rgba(20,184,166,0.2)", color: "#2dd4bf" }}>
              {pendingDecision.value === "uphold" ? "Uphold" : `Overturn: ${REASON_LABELS[pendingReason.value || ""] || pendingReason.value}`}
            </div>
            <div style={{ fontSize: "11px", color: "#6e7681", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.8px", fontWeight: "600" }}>Type YES to proceed</div>
            <input
              type="text"
              autoComplete="off"
              value={confirmInput.value}
              style={{ width: "100%", padding: "10px 14px", background: "#0a0e14", border: "1px solid #1e2736", borderRadius: "10px", color: "#c9d1d9", fontSize: "16px", fontWeight: "600", textAlign: "center", letterSpacing: "2px", textTransform: "uppercase", outline: "none" }}
              onInput={(e) => { confirmInput.value = (e.target as HTMLInputElement).value; }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && confirmInput.value.trim().toUpperCase() === "YES" && pendingDecision.value) {
                  const dec = pendingDecision.value; const rsn = pendingReason.value || undefined;
                  confirmOpen.value = false; pendingDecision.value = null;
                  executeDecision(dec, rsn);
                } else if (e.key === "Escape") { confirmOpen.value = false; pendingDecision.value = null; }
                e.stopPropagation();
              }}
            />
            <div style={{ display: "flex", gap: "8px", marginTop: "16px", justifyContent: "flex-end" }}>
              <button
                style={{ padding: "8px 20px", borderRadius: "8px", fontSize: "12px", fontWeight: "600", cursor: "pointer", background: "transparent", border: "1px solid #1e2736", color: "#6e7681" }}
                onClick={() => { confirmOpen.value = false; pendingDecision.value = null; }}
              >Cancel</button>
              <button
                style={{ padding: "8px 20px", borderRadius: "8px", fontSize: "12px", fontWeight: "600", cursor: "pointer", background: "#14b8a6", border: "none", color: "#fff", opacity: confirmInput.value.trim().toUpperCase() === "YES" ? 1 : 0.3 }}
                disabled={confirmInput.value.trim().toUpperCase() !== "YES"}
                onClick={() => {
                  if (!pendingDecision.value) return;
                  const dec = pendingDecision.value; const rsn = pendingReason.value || undefined;
                  confirmOpen.value = false; pendingDecision.value = null;
                  executeDecision(dec, rsn);
                }}
              >Submit</button>
            </div>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div style={{ position: "fixed", bottom: "56px", left: "50%", transform: "translateX(-50%)", zIndex: "1000", display: "flex", flexDirection: "column-reverse", gap: "6px", alignItems: "center", pointerEvents: "none" }}>
        {toasts.value.map((t) => (
          <div key={t.id} class={`toast toast-${t.type}`}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}

const JUDGE_QUEUE_CSS = `
  .meta-chip { display: inline-flex; align-items: center; gap: 4px; background: #141820; border: 1px solid #1a1f2b; border-radius: 6px; padding: 3px 10px; font-size: 11px; color: #6e7681; white-space: nowrap; }
  .meta-chip strong { color: #c9d1d9; font-weight: 600; }
  .meta-chip.last-item { background: rgba(250,176,5,0.12); border-color: rgba(250,176,5,0.25); color: #fab005; }
  .meta-chip.last-item strong { color: #fab005; }

  .t-line { font-size: 13.5px; line-height: 1.75; margin-bottom: 10px; padding: 6px 10px 6px 12px; border-left: 3px solid transparent; color: #6e7681; break-inside: avoid; border-radius: 0 6px 6px 0; }
  .t-agent { border-left-color: #0d9488; color: #5eead4; }
  .t-customer { border-left-color: #2dd4bf; color: #99f6e4; }
  .t-system { border-left-color: #2d333b; color: #484f58; }
  .t-highlight { background: rgba(20,184,166,0.08); }
  .t-evidence { background: rgba(250,176,5,0.1); border-left-color: #fab005 !important; }
  .t-evidence .t-speaker { color: #fab005 !important; }
  .t-speaker { font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; margin-right: 8px; }
  .t-agent .t-speaker { color: #0d9488; }
  .t-customer .t-speaker { color: #2dd4bf; }
  .t-system .t-speaker { color: #484f58; }
  .t-search-match { background: rgba(250,176,5,0.18) !important; }
  .t-search-active { background: rgba(250,176,5,0.35) !important; outline: 1px solid rgba(250,176,5,0.5); outline-offset: -1px; }

  .combo-counter { transition: all 0.2s; }
  .combo-dim { color: #3d4452; }
  .combo-hot { color: #14b8a6; text-shadow: 0 0 8px rgba(20,184,166,0.4); }
  .combo-fire { color: #fab005; text-shadow: 0 0 10px rgba(250,176,5,0.5); animation: comboPulse 1.5s ease infinite; }
  .combo-inferno { color: #ef4444; text-shadow: 0 0 14px rgba(239,68,68,0.6); animation: comboPulse 0.8s ease infinite; }
  .combo-godlike { color: #a855f7; text-shadow: 0 0 18px rgba(168,85,247,0.7); animation: comboPulse 0.5s ease infinite; }
  @keyframes comboPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.7; } }

  .streak-banner { position: fixed; top: 18%; left: 50%; transform: translate(-50%,0) scale(1); font-size: 28px; font-weight: 900; text-transform: uppercase; letter-spacing: 3px; z-index: 2000; pointer-events: none; text-shadow: 0 0 30px currentColor; padding: 12px 32px; border-radius: 12px; background: rgba(11,15,21,0.65); backdrop-filter: blur(12px); }
  .s-double { color: #14b8a6; }
  .s-triple { color: #fab005; font-size: 32px; }
  .s-mega { color: #ef4444; font-size: 36px; }
  .s-ultra { color: #ec4899; font-size: 40px; }
  .s-rampage { color: #a855f7; font-size: 44px; }
  .s-godlike { color: #fbbf24; font-size: 50px; text-shadow: 0 0 40px #fbbf24; }

  .judge-btn { width: 100%; padding: 8px 12px; border-radius: 8px; font-size: 12px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 8px; border: none; transition: all 0.15s; }
  .judge-btn kbd { background: rgba(255,255,255,0.1); border-radius: 3px; padding: 1px 6px; font-family: monospace; font-size: 11px; }
  .judge-btn.uphold { background: rgba(20,184,166,0.15); color: #14b8a6; border: 1px solid rgba(20,184,166,0.3); }
  .judge-btn.uphold:hover { background: rgba(20,184,166,0.25); }
  .judge-btn.overturn { background: rgba(248,81,73,0.10); color: #f85149; border: 1px solid rgba(248,81,73,0.2); }
  .judge-btn.overturn:hover { background: rgba(248,81,73,0.18); }

  .toast { padding: 7px 18px; border-radius: 20px; font-size: 12px; font-weight: 600; backdrop-filter: blur(12px); box-shadow: 0 4px 20px rgba(0,0,0,0.4); letter-spacing: 0.3px; animation: toastIn 0.15s ease; }
  .toast-uphold { background: rgba(63,185,80,0.85); color: #fff; }
  .toast-overturn { background: rgba(239,68,68,0.85); color: #fff; }
  .toast-undo { background: rgba(100,116,139,0.85); color: #fff; }
  .toast-error { background: rgba(218,54,51,0.85); color: #fff; }
  .toast-info { background: rgba(30,39,54,0.9); color: #c9d1d9; border: 1px solid #2d333b; }
  .toast-complete { background: rgba(20,184,166,0.85); color: #fff; }
  .toast-combo { background: rgba(139,92,246,0.9); color: #fff; }
  @keyframes toastIn { from { opacity: 0; transform: translateY(6px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }

  #transcript-body-judge::-webkit-scrollbar { display: none; }
`;
