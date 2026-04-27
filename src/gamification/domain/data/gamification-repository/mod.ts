/** Gamification repository — sound packs, settings, badges, game state, store.
 *  Ported from lib/kv.ts gamification sections. */

import { getKv, orgKey } from "@core/data/deno-kv/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import type { BadgeStats, BadgeDef, GameState } from "@core/dto/types.ts";

// ── Sound Packs ──────────────────────────────────────────────────────────────

export interface SoundPackMeta { id: string; name: string; slots: Record<string, string>; createdAt: number; createdBy: string; }

export async function listSoundPacks(orgId: OrgId): Promise<SoundPackMeta[]> {
  const db = await getKv();
  const r: SoundPackMeta[] = [];
  for await (const e of db.list<SoundPackMeta>({ prefix: orgKey(orgId, "sound-pack") })) r.push(e.value);
  return r;
}

export async function getSoundPack(orgId: OrgId, packId: string): Promise<SoundPackMeta | null> {
  return (await (await getKv()).get<SoundPackMeta>(orgKey(orgId, "sound-pack", packId))).value;
}

export async function saveSoundPack(orgId: OrgId, pack: SoundPackMeta): Promise<void> {
  await (await getKv()).set(orgKey(orgId, "sound-pack", pack.id), pack);
}

export async function deleteSoundPack(orgId: OrgId, packId: string): Promise<void> {
  await (await getKv()).delete(orgKey(orgId, "sound-pack", packId));
}

// ── Gamification Settings ────────────────────────────────────────────────────

export interface GamificationSettings { threshold: number | null; comboTimeoutMs: number | null; enabled: boolean | null; sounds: Record<string, string> | null; }
const DEFAULTS: Required<{ [K in keyof GamificationSettings]: NonNullable<GamificationSettings[K]> }> = { threshold: 0, comboTimeoutMs: 10000, enabled: true, sounds: {} };

export async function getGamificationSettings(orgId: OrgId): Promise<GamificationSettings | null> {
  return (await (await getKv()).get<GamificationSettings>(orgKey(orgId, "gamification-settings"))).value;
}

export async function saveGamificationSettings(orgId: OrgId, settings: GamificationSettings): Promise<void> {
  await (await getKv()).set(orgKey(orgId, "gamification-settings"), settings);
}

export async function getJudgeGamificationOverride(orgId: OrgId, email: string): Promise<GamificationSettings | null> {
  return (await (await getKv()).get<GamificationSettings>(orgKey(orgId, "gamification-settings", "judge", email))).value;
}

export async function saveJudgeGamificationOverride(orgId: OrgId, email: string, settings: GamificationSettings): Promise<void> {
  await (await getKv()).set(orgKey(orgId, "gamification-settings", "judge", email), settings);
}

export async function getReviewerGamificationOverride(orgId: OrgId, email: string): Promise<GamificationSettings | null> {
  return (await (await getKv()).get<GamificationSettings>(orgKey(orgId, "gamification-settings", "reviewer", email))).value;
}

export async function saveReviewerGamificationOverride(orgId: OrgId, email: string, settings: GamificationSettings): Promise<void> {
  await (await getKv()).set(orgKey(orgId, "gamification-settings", "reviewer", email), settings);
}

function overlaySettings(base: Record<string, unknown>, override: GamificationSettings | null): Record<string, unknown> {
  if (!override) return base;
  const result = { ...base };
  for (const key of Object.keys(override) as (keyof GamificationSettings)[]) {
    if (override[key] !== null && override[key] !== undefined) result[key] = override[key];
  }
  return result;
}

export async function resolveGamificationSettings(orgId: OrgId, email: string, role: string, supervisor?: string | null) {
  let merged: Record<string, unknown> = { ...DEFAULTS };
  merged = overlaySettings(merged, await getGamificationSettings(orgId));
  if (role === "reviewer" && supervisor) merged = overlaySettings(merged, await getJudgeGamificationOverride(orgId, supervisor));
  merged = overlaySettings(merged, await getReviewerGamificationOverride(orgId, email));
  return merged as unknown as { threshold: number; comboTimeoutMs: number; enabled: boolean; sounds: Record<string, string> };
}

// ── Store Items ──────────────────────────────────────────────────────────────

export interface StoreItem { id: string; name: string; description: string; price: number; icon: string; category: string; }

export async function listCustomStoreItems(orgId: OrgId): Promise<StoreItem[]> {
  const db = await getKv();
  const r: StoreItem[] = [];
  for await (const e of db.list<StoreItem>({ prefix: orgKey(orgId, "store-item") })) r.push(e.value);
  return r;
}

export async function saveCustomStoreItem(orgId: OrgId, item: StoreItem): Promise<void> {
  await (await getKv()).set(orgKey(orgId, "store-item", item.id), item);
}

export async function deleteCustomStoreItem(orgId: OrgId, itemId: string): Promise<void> {
  await (await getKv()).delete(orgKey(orgId, "store-item", itemId));
}

// ── Badges ───────────────────────────────────────────────────────────────────

export interface EarnedBadge { badgeId: string; earnedAt: number; }
const DEFAULT_BADGE_STATS: BadgeStats = { totalAudits: 0, perfectScoreCount: 0, avgScore: 0, auditsForAvg: 0, dayStreak: 0, lastActiveDate: "" };

export async function getEarnedBadges(orgId: OrgId, email: string): Promise<EarnedBadge[]> {
  const db = await getKv();
  const r: EarnedBadge[] = [];
  for await (const e of db.list<EarnedBadge>({ prefix: orgKey(orgId, "earned-badge", email) })) r.push(e.value);
  return r;
}

export async function awardBadge(orgId: OrgId, email: string, badge: BadgeDef): Promise<boolean> {
  const db = await getKv();
  const key = orgKey(orgId, "earned-badge", email, badge.id);
  const existing = await db.get(key);
  if (existing.value) return false;
  const res = await db.atomic().check(existing).set(key, { badgeId: badge.id, earnedAt: Date.now() }).commit();
  return res.ok;
}

export async function getBadgeStats(orgId: OrgId, email: string): Promise<BadgeStats> {
  return (await (await getKv()).get<BadgeStats>(orgKey(orgId, "badge-stats", email))).value ?? { ...DEFAULT_BADGE_STATS };
}

export async function updateBadgeStats(orgId: OrgId, email: string, patch: Partial<BadgeStats>): Promise<BadgeStats> {
  const db = await getKv();
  const current = (await db.get<BadgeStats>(orgKey(orgId, "badge-stats", email))).value ?? { ...DEFAULT_BADGE_STATS };
  const updated = { ...current, ...patch };
  await db.set(orgKey(orgId, "badge-stats", email), updated);
  return updated;
}

// ── Game State ───────────────────────────────────────────────────────────────

const DEFAULT_GAME_STATE: GameState = { xp: 0, level: 1, dayStreak: 0, cosmetics: {} };

export async function getGameState(orgId: OrgId, email: string): Promise<GameState & { totalXp: number; tokenBalance: number; purchases: string[]; lastActiveDate: string }> {
  const db = await getKv();
  const v = (await db.get(orgKey(orgId, "game-state", email))).value as any;
  return v ?? { ...DEFAULT_GAME_STATE, totalXp: 0, tokenBalance: 0, purchases: [], lastActiveDate: "" };
}

export async function saveGameState(orgId: OrgId, email: string, state: Record<string, unknown>): Promise<void> {
  await (await getKv()).set(orgKey(orgId, "game-state", email), state);
}

/** Walk every game-state in the org. Used by leaderboards. */
export async function listGameStates(orgId: OrgId): Promise<Array<{ email: string; state: GameState & { totalXp?: number; tokenBalance?: number; lastActiveDate?: string } }>> {
  const db = await getKv();
  const out: Array<{ email: string; state: GameState & { totalXp?: number; tokenBalance?: number; lastActiveDate?: string } }> = [];
  for await (const entry of db.list({ prefix: orgKey(orgId, "game-state") })) {
    const key = entry.key as Deno.KvKey;
    const email = String(key[key.length - 1]);
    if (!email) continue;
    out.push({ email, state: entry.value as GameState & { totalXp?: number; tokenBalance?: number; lastActiveDate?: string } });
  }
  return out;
}

export async function purchaseStoreItem(orgId: OrgId, email: string, itemId: string, price: number): Promise<{ ok: true; newBalance: number } | { ok: false; error: string }> {
  const db = await getKv();
  const key = orgKey(orgId, "game-state", email);
  const entry = await db.get<any>(key);
  const state = entry.value ?? { ...DEFAULT_GAME_STATE, totalXp: 0, tokenBalance: 0, purchases: [], lastActiveDate: "" };
  if (state.purchases?.includes(itemId)) return { ok: false, error: "already purchased" };
  if ((state.tokenBalance ?? 0) < price) return { ok: false, error: "insufficient tokens" };
  state.tokenBalance -= price;
  if (!state.purchases) state.purchases = [];
  state.purchases.push(itemId);
  const res = await db.atomic().check(entry).set(key, state).commit();
  if (!res.ok) return { ok: false, error: "concurrent modification, try again" };
  return { ok: true, newBalance: state.tokenBalance };
}

// ── Award XP ─────────────────────────────────────────────────────────────────

import { getLevel, LEVEL_THRESHOLDS, AGENT_LEVEL_THRESHOLDS } from "@gamification/domain/business/badge-system/mod.ts";

export async function awardXp(
  orgId: OrgId, email: string, xpAmount: number, role: "reviewer" | "judge" | "manager" | "agent",
): Promise<{ state: any; xpGained: number; leveledUp: boolean }> {
  const state = await getGameState(orgId, email);
  const prevLevel = state.level;
  state.totalXp = (state.totalXp ?? 0) + xpAmount;
  state.tokenBalance = (state.tokenBalance ?? 0) + xpAmount;
  const thresholds = role === "agent" ? AGENT_LEVEL_THRESHOLDS : LEVEL_THRESHOLDS;
  state.level = getLevel(state.totalXp, thresholds);
  const today = new Date().toISOString().slice(0, 10);
  if (state.lastActiveDate !== today) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    state.dayStreak = state.lastActiveDate === yesterday ? state.dayStreak + 1 : 1;
    state.lastActiveDate = today;
  }
  await saveGameState(orgId, email, state as any);
  const leveledUp = state.level > prevLevel;
  return { state, xpGained: xpAmount, leveledUp };
}
