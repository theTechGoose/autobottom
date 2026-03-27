import { Component } from "@sprig/kit";
import type { QueueItem } from "../../../../_dto/queue-item.ts";
import type { Transcript } from "../../../../_dto/transcript.ts";
import type { GameConfig } from "../../../../_dto/game-config.ts";
import {
  REVIEWER_LEVEL_THRESHOLDS as LEVEL_THRESHOLDS,
  STREAKS,
} from "../../../../_dto/game-config.ts";

const API = "/judge/api";
const STORAGE_PREFIX = "judge";

const APPEAL_LABELS: Record<string, string> = {
  redo: "Redo",
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
export class JudgeQueue {
  view: "loading" | "review" | "empty" = "loading";
  currentItem: QueueItem | null = null;
  peekItem: QueueItem | null = null;
  currentTranscript: Transcript | null = null;
  auditRemaining = 0;
  busy = false;
  pendingDecision: string | null = null;
  pendingReason: string | null = null;
  reviewer = "";
  thinkingOpen = false;
  cheatOpen = false;
  confirmOpen = false;
  confirmInput = "";

  // Gamification
  combo = 0;
  comboDropped = false;
  xp = 0;
  streakDays = 0;
  sessionReviews = 0;
  sessionXpGained = 0;
  bestCombo = 0;
  timeBankVal = 0;

  // Speed tracking
  speedAvg = "--";
  progressPct = 0;
  levelNum = 1;
  xpBarPct = 0;
  xpDisplay = "0xp";

  // Streak banner
  streakBannerText = "";
  streakBannerCls = "";
  streakBannerVisible = false;

  // Session summary
  summaryHtml = "";

  // Audio
  audioPlaying = false;
  audioTime = "0:00";
  audioFillPct = 0;

  // Search
  searchOpen = false;
  searchQuery = "";
  searchMatchCount = 0;
  searchActiveIdx = -1;

  // Transcript lines
  transcriptLines: Array<{ cls: string; speaker?: string; content: string }> = [];

  // Game config (not reactive, internal)
  private gameConfig: GameConfig = { threshold: 0, comboTimeoutMs: 10000, enabled: true };
  private lastReviewTs = 0;
  private decisionTimes: number[] = [];
  private lastDecisionTs: number | null = null;
  private totalDecided = 0;
  private totalItems = 0;
  private transcriptCache: Record<string, Transcript> = {};

  // -- Helpers exposed for template/tests --

  getAppealLabel(type: string): string {
    return APPEAL_LABELS[type] || type;
  }

  getReasonLabel(reason: string): string {
    return REASON_LABELS[reason] || reason;
  }

  isYesAnswer(a: string | undefined): boolean {
    const s = String(a || "").trim().toLowerCase();
    return s.startsWith("yes") || s === "true" || s === "y" || s === "1";
  }

  getComboClass(combo: number): string {
    if (combo <= 0) return "combo-dim";
    if (combo >= 23) return "combo-godlike";
    if (combo >= 12) return "combo-inferno";
    if (combo >= 5) return "combo-fire";
    if (combo >= 3) return "combo-hot";
    return "combo-dim";
  }

  toggleThinking(): void {
    this.thinkingOpen = !this.thinkingOpen;
  }

  toggleCheatSheet(): void {
    this.cheatOpen = !this.cheatOpen;
  }

  // -- Game state persistence --

  private getGameState(): Record<string, unknown> {
    try {
      return JSON.parse(
        localStorage.getItem(`${STORAGE_PREFIX}_game_${this.reviewer}`) || "{}",
      );
    } catch {
      return {};
    }
  }

  private saveGameState(patch: Record<string, unknown>): void {
    const state = { ...this.getGameState(), ...patch };
    localStorage.setItem(
      `${STORAGE_PREFIX}_game_${this.reviewer}`,
      JSON.stringify(state),
    );
  }

  private loadGameState(): void {
    const state = this.getGameState();
    this.xp = (state.xp as number) || 0;
    this.streakDays = (state.streakDays as number) || 0;
    this.combo = 0;
    this.sessionReviews = 0;
    this.sessionXpGained = 0;
    this.bestCombo = 0;
    this.lastReviewTs = 0;
    this.updateLevelDisplay((state.xp as number) || 0);
  }

  private updateLevelDisplay(xpVal: number): void {
    const level = getLevel(xpVal);
    const cur = LEVEL_THRESHOLDS[level - 1] || 0;
    const next = LEVEL_THRESHOLDS[level] ?? LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
    const pct = next > cur ? ((xpVal - cur) / (next - cur)) * 100 : 100;
    this.levelNum = level;
    this.xpBarPct = pct;
    this.xpDisplay = `${xpVal.toLocaleString()}xp`;
  }

  private awardXp(base: number): void {
    const state = this.getGameState();
    const oldXp = (state.xp as number) || 0;
    const oldLevel = getLevel(oldXp);
    const mult = getComboMultiplier(this.combo);
    const gained = Math.round(base * mult);
    const newXp = oldXp + gained;
    const newLevel = getLevel(newXp);
    this.saveGameState({ xp: newXp });
    this.xp = newXp;
    this.sessionXpGained = this.sessionXpGained + gained;
    this.updateLevelDisplay(newXp);
    if (newLevel > oldLevel) {
      // Level up notification would go here
    }
  }

  private updateStreak(): void {
    const state = this.getGameState();
    const today = new Date().toISOString().slice(0, 10);
    const todayCount = (state.todayDate as string) === today
      ? ((state.todayCount as number) || 0) + 1
      : 1;
    let days = (state.streakDays as number) || 0;
    let lastStreakDate = (state.lastStreakDate as string) || "";
    if (todayCount >= 5 && lastStreakDate !== today) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      days = lastStreakDate === yesterday ? days + 1 : 1;
      lastStreakDate = today;
    }
    this.saveGameState({ todayDate: today, todayCount, streakDays: days, lastStreakDate });
    this.streakDays = days;
  }

  private tickCombo(): void {
    const now = Date.now();
    const cfg = this.gameConfig;
    const COMBO_TIMEOUT = cfg.comboTimeoutMs || 10000;

    if (this.lastReviewTs && (now - this.lastReviewTs) > COMBO_TIMEOUT) {
      if (this.combo > 0) this.comboDropped = true;
      this.combo = 0;
    }

    this.combo = this.combo + 1;
    this.lastReviewTs = now;
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;

    const maxStreak = STREAKS[STREAKS.length - 1];
    if (this.combo > maxStreak.at) {
      this.showStreakBanner(maxStreak.label, maxStreak.cls);
      return;
    }
    const matched = STREAKS.find((s) => s.at === this.combo);
    if (matched) this.showStreakBanner(matched.label, matched.cls);
  }

  private showStreakBanner(label: string, cls: string): void {
    this.streakBannerText = label;
    this.streakBannerCls = cls;
    this.streakBannerVisible = true;
    setTimeout(() => { this.streakBannerVisible = false; }, 1300);
  }

  private trackDecision(): void {
    const now = Date.now();
    if (this.lastDecisionTs) {
      const elapsed = (now - this.lastDecisionTs) / 1000;
      this.decisionTimes.push(elapsed);
      if (this.decisionTimes.length > 20) this.decisionTimes.shift();
      const avg = this.decisionTimes.reduce((a, b) => a + b, 0) / this.decisionTimes.length;
      this.speedAvg = avg.toFixed(1);
    }
    this.lastDecisionTs = now;
    this.totalDecided++;
  }

  private updateProgress(remaining: number): void {
    const total = this.totalItems || (this.totalDecided + remaining);
    if (total <= 0) return;
    this.progressPct = Math.min(100, (this.totalDecided / total) * 100);
  }

  private buildSessionSummary(): void {
    const reviews = this.sessionReviews;
    if (reviews === 0) { this.summaryHtml = ""; return; }
    const times = this.decisionTimes;
    const avgTime = times.length > 0
      ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1) : "--";
    this.summaryHtml = `${reviews} reviews / ${this.bestCombo}x best combo / avg ${avgTime}s / +${this.sessionXpGained} XP`;
  }

  private extractEvidenceSnippets(defense: string, thinking: string): string[] {
    const snippets: string[] = [];
    const combined = (defense || "") + " " + (thinking || "");
    const sq = combined.match(/'([^']{10,})'/g);
    if (sq) sq.forEach((m) => snippets.push(m.slice(1, -1).toLowerCase()));
    const dq = combined.match(/"([^"]{10,})"/g);
    if (dq) dq.forEach((m) => snippets.push(m.slice(1, -1).toLowerCase()));
    return snippets;
  }

  private buildTranscriptLines(item: QueueItem | null, tr: Transcript | null): void {
    if (!tr || (!tr.diarized && !tr.raw)) {
      this.transcriptLines = [{ cls: "t-empty", content: "No transcript available" }];
      return;
    }
    const text = tr.diarized || tr.raw || "";
    const defLow = ((item?.defense) || "").toLowerCase();
    const snippets = this.extractEvidenceSnippets(item?.defense || "", item?.thinking || "");
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
    this.transcriptLines = result;
  }

  // -- Public actions --

  decide(decision: string, reason?: string): void {
    if (!this.currentItem || this.busy) return;
    if (this.auditRemaining === 1) {
      this.pendingDecision = decision;
      this.pendingReason = reason || null;
      this.confirmInput = "";
      this.confirmOpen = true;
      return;
    }
    this.executeDecision(decision, reason);
  }

  async executeDecision(decision: string, reason?: string): Promise<void> {
    const item = this.currentItem;
    if (!item || this.busy) return;
    this.busy = true;

    this.trackDecision();
    this.tickCombo();
    this.sessionReviews = this.sessionReviews + 1;
    this.awardXp(decision === "uphold" ? 10 : 15);
    this.updateStreak();

    let didSwap = false;
    if (this.peekItem) {
      didSwap = true;
      const next = this.peekItem;
      this.currentItem = next;
      this.peekItem = null;
      const cached = this.transcriptCache[next.findingId];
      if (cached) this.currentTranscript = cached;
      this.buildTranscriptLines(next, cached || null);
    }

    const body: Record<string, unknown> = {
      findingId: item.findingId,
      questionIndex: item.questionIndex,
      decision,
      combo: this.combo,
      level: getLevel(this.sessionXpGained),
    };
    if (reason) body.reason = reason;

    try {
      const res = await fetch(`${API}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.status === 409) { this.busy = false; return; }
      if (!res.ok) throw new Error(data.error || "Request failed");

      const remaining = data.next?.remaining ?? 0;
      this.updateProgress(remaining);

      if (data.next?.current) {
        this.auditRemaining = data.next.auditRemaining || 0;
        if (didSwap) {
          this.peekItem = data.next.peek || null;
        } else {
          this.currentItem = data.next.current;
          this.peekItem = data.next.peek || null;
          this.currentTranscript = data.next.transcript || null;
          if (data.next.transcript && data.next.current) {
            this.transcriptCache[data.next.current.findingId] = data.next.transcript;
          }
          this.buildTranscriptLines(data.next.current, data.next.transcript || null);
        }
        if (data.next.transcript && data.next.current) {
          this.transcriptCache[data.next.current.findingId] = data.next.transcript;
        }
      } else if (!didSwap) {
        this.view = "empty";
        this.buildSessionSummary();
      } else {
        this.peekItem = null;
      }
    } catch {
      // error toast would go here
    }
    this.busy = false;
  }

  async goBack(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const res = await fetch(`${API}/back`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Back failed");
      this.currentItem = data.current;
      this.currentTranscript = data.transcript || null;
      this.peekItem = data.peek || null;
      this.auditRemaining = data.auditRemaining || 0;
      if (data.transcript && data.current) {
        this.transcriptCache[data.current.findingId] = data.transcript;
      }
      this.buildTranscriptLines(data.current, data.transcript || null);
      this.view = "review";
      if (this.combo > 0) this.comboDropped = true;
      this.combo = 0;
      this.totalDecided = Math.max(0, this.totalDecided - 1);
      this.updateProgress(data.remaining || 0);
    } catch {
      // error toast would go here
    }
    this.busy = false;
  }

  async init(): Promise<void> {
    try {
      const res = await fetch(`${API}/next`);
      if (!res.ok) { globalThis.location.href = "/login"; return; }
      const data = await res.json();
      this.reviewer = data.reviewer || "judge";
      this.loadGameState();

      try {
        const gcRes = await fetch(`${API}/gamification`);
        if (gcRes.ok) {
          const gc = await gcRes.json();
          this.gameConfig = gc.resolved || this.gameConfig;
        }
      } catch { /* ignore */ }

      try {
        const statsRes = await fetch(`${API}/stats`);
        if (statsRes.ok) {
          const stats = await statsRes.json();
          this.totalItems = (stats.pending || 0) + (stats.decided || 0);
          this.totalDecided = stats.decided || 0;
          this.updateProgress(stats.pending || 0);
        }
      } catch { /* ignore */ }

      if (data.current) {
        this.currentItem = data.current;
        this.peekItem = data.peek || null;
        this.currentTranscript = data.transcript || null;
        this.auditRemaining = data.auditRemaining || 0;
        if (data.transcript && data.current) {
          this.transcriptCache[data.current.findingId] = data.transcript;
        }
        this.buildTranscriptLines(data.current, data.transcript || null);
        this.view = "review";
      } else {
        this.view = "empty";
      }
    } catch {
      globalThis.location.href = "/login";
    }
  }
}
