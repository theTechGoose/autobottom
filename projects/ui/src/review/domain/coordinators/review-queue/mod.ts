import { Component } from "@sprig/kit";

// deno-lint-ignore no-explicit-any
type QueueItem = any;
// deno-lint-ignore no-explicit-any
type Transcript = any;
// deno-lint-ignore no-explicit-any
type ToastEntry = any;

const LEVEL_THRESHOLDS = [0, 100, 300, 600, 1100, 2000, 3500, 5500, 8000, 12000];

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

@Component({ template: "./mod.html", island: true })
export class ReviewQueue {
  // View state
  view: "loading" | "review" | "empty" = "loading";
  currentItem: QueueItem | null = null;
  peekItem: QueueItem | null = null;
  currentTranscript: Transcript | null = null;
  auditRemaining = 0;
  busy = false;

  // Gamification
  combo = 0;
  xp = 0;
  streakDays = 0;
  sessionReviews = 0;
  sessionXpGained = 0;
  bestCombo = 0;
  timeBankVal = 0;

  // Speed tracking
  speedAvg = "--";

  // Level/XP display
  levelNum = 1;
  xpBarPct = 0;
  xpDisplay = "0xp";

  // Progress
  progressPct = 0;

  // Streak banner
  streakBannerText = "";
  streakBannerCls = "";
  streakBannerVisible = false;

  // Audio state
  audioPlaying = false;
  audioTime = "0:00";
  audioFillPct = 0;

  // Search state
  searchOpen = false;
  searchQuery = "";
  searchMatchCount = 0;
  searchActiveIdx = -1;

  // Toast
  toasts: ToastEntry[] = [];

  // Session summary
  summaryHtml = "";

  // Confirmation modal
  pendingDecision: string | null = null;
  pendingReason: string | null = null;
  confirmOpen = false;
  confirmInput = "";

  fetchNext() {
    // Coordinator fetches next item from ReviewApi service
  }

  decide(_decision: string) {
    // Coordinator handles decision logic
  }

  goBack() {
    // Coordinator handles undo logic
  }

  loadTranscript() {
    // Load transcript for current item
  }

  setupKeyboard() {
    // Wire keyboard shortcuts: Y=confirm, N=flip, D=toggle, B=undo, H/L=scroll, P=play/pause, arrows=seek, /=search, ;=next match, ?=cheatsheet
  }

  computeLevel(xpVal: number) {
    const level = getLevel(xpVal);
    const cur = LEVEL_THRESHOLDS[level - 1] || 0;
    const next = LEVEL_THRESHOLDS[level] ?? LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
    const pct = next > cur ? ((xpVal - cur) / (next - cur)) * 100 : 100;
    this.levelNum = level;
    this.xpBarPct = pct;
    this.xpDisplay = `${xpVal.toLocaleString()}xp`;
  }

  awardXp(base: number) {
    const mult = getComboMultiplier(this.combo);
    const gained = Math.round(base * mult);
    this.xp += gained;
    this.sessionXpGained += gained;
    this.computeLevel(this.xp);
  }

  updateCombo() {
    this.combo += 1;
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;
  }

  persistGameState() {
    // Save game state to localStorage
  }

  showToast(msg: string, _type = "info") {
    this.toasts = [...this.toasts, { id: Date.now(), msg, type: _type }];
  }
}
