/** Gamification repository — sound packs, settings, badges, game state, store.
 *  Firestore-backed via setStored* helpers. */

import {
  getStored, setStored, deleteStored, setStoredIfAbsent,
  listStored, listStoredWithKeys,
} from "@core/data/firestore/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import type { BadgeStats, BadgeDef, GameState } from "@core/dto/types.ts";

// ── Sound Packs ──────────────────────────────────────────────────────────────

export interface SoundPackMeta { id: string; name: string; slots: Record<string, string>; createdAt: number; createdBy: string; }

export async function listSoundPacks(orgId: OrgId): Promise<SoundPackMeta[]> {
  return await listStored<SoundPackMeta>("sound-pack", orgId);
}

export async function getSoundPack(orgId: OrgId, packId: string): Promise<SoundPackMeta | null> {
  return await getStored<SoundPackMeta>("sound-pack", orgId, packId);
}

export async function saveSoundPack(orgId: OrgId, pack: SoundPackMeta): Promise<void> {
  await setStored("sound-pack", orgId, [pack.id], pack);
}

export async function deleteSoundPack(orgId: OrgId, packId: string): Promise<void> {
  await deleteStored("sound-pack", orgId, packId);
}

// ── Gamification Settings ────────────────────────────────────────────────────

export interface GamificationSettings { threshold: number | null; comboTimeoutMs: number | null; enabled: boolean | null; sounds: Record<string, string> | null; }
const DEFAULTS: Required<{ [K in keyof GamificationSettings]: NonNullable<GamificationSettings[K]> }> = { threshold: 0, comboTimeoutMs: 10000, enabled: true, sounds: {} };

export async function getGamificationSettings(orgId: OrgId): Promise<GamificationSettings | null> {
  return await getStored<GamificationSettings>("gamification-settings", orgId);
}

export async function saveGamificationSettings(orgId: OrgId, settings: GamificationSettings): Promise<void> {
  await setStored("gamification-settings", orgId, [], settings);
}

export async function getJudgeGamificationOverride(orgId: OrgId, email: string): Promise<GamificationSettings | null> {
  return await getStored<GamificationSettings>("gamification-settings", orgId, "judge", email);
}

export async function saveJudgeGamificationOverride(orgId: OrgId, email: string, settings: GamificationSettings): Promise<void> {
  await setStored("gamification-settings", orgId, ["judge", email], settings);
}

export async function getReviewerGamificationOverride(orgId: OrgId, email: string): Promise<GamificationSettings | null> {
  return await getStored<GamificationSettings>("gamification-settings", orgId, "reviewer", email);
}

export async function saveReviewerGamificationOverride(orgId: OrgId, email: string, settings: GamificationSettings): Promise<void> {
  await setStored("gamification-settings", orgId, ["reviewer", email], settings);
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
  return await listStored<StoreItem>("store-item", orgId);
}

export async function saveCustomStoreItem(orgId: OrgId, item: StoreItem): Promise<void> {
  await setStored("store-item", orgId, [item.id], item);
}

export async function deleteCustomStoreItem(orgId: OrgId, itemId: string): Promise<void> {
  await deleteStored("store-item", orgId, itemId);
}

// ── Badges ───────────────────────────────────────────────────────────────────

export interface EarnedBadge { badgeId: string; earnedAt: number; }
const DEFAULT_BADGE_STATS: BadgeStats = { totalAudits: 0, perfectScoreCount: 0, avgScore: 0, auditsForAvg: 0, dayStreak: 0, lastActiveDate: "" };

export async function getEarnedBadges(orgId: OrgId, email: string): Promise<EarnedBadge[]> {
  // earned-badge keys are [email, badgeId] — list all docs of this type+org
  // and filter to those for this email.
  const rows = await listStoredWithKeys<EarnedBadge>("earned-badge", orgId);
  const out: EarnedBadge[] = [];
  for (const { key, value } of rows) {
    if (key[0] === email) out.push(value);
  }
  return out;
}

export async function awardBadge(orgId: OrgId, email: string, badge: BadgeDef): Promise<boolean> {
  return await setStoredIfAbsent(
    "earned-badge", orgId, [email, badge.id],
    { badgeId: badge.id, earnedAt: Date.now() },
  );
}

export async function getBadgeStats(orgId: OrgId, email: string): Promise<BadgeStats> {
  return (await getStored<BadgeStats>("badge-stats", orgId, email)) ?? { ...DEFAULT_BADGE_STATS };
}

export async function updateBadgeStats(orgId: OrgId, email: string, patch: Partial<BadgeStats>): Promise<BadgeStats> {
  const current = (await getStored<BadgeStats>("badge-stats", orgId, email)) ?? { ...DEFAULT_BADGE_STATS };
  const updated = { ...current, ...patch };
  await setStored("badge-stats", orgId, [email], updated);
  return updated;
}

// ── Game State ───────────────────────────────────────────────────────────────

const DEFAULT_GAME_STATE: GameState = { xp: 0, level: 1, dayStreak: 0, cosmetics: {} };
type FullGameState = GameState & { totalXp: number; tokenBalance: number; purchases: string[]; lastActiveDate: string };
const DEFAULT_FULL_STATE: FullGameState = { ...DEFAULT_GAME_STATE, totalXp: 0, tokenBalance: 0, purchases: [], lastActiveDate: "" };

export async function getGameState(orgId: OrgId, email: string): Promise<FullGameState> {
  return (await getStored<FullGameState>("game-state", orgId, email)) ?? { ...DEFAULT_FULL_STATE };
}

export async function saveGameState(orgId: OrgId, email: string, state: Record<string, unknown>): Promise<void> {
  await setStored("game-state", orgId, [email], state);
}

/** Walk every game-state in the org. Used by leaderboards. */
export async function listGameStates(orgId: OrgId): Promise<Array<{ email: string; state: GameState & { totalXp?: number; tokenBalance?: number; lastActiveDate?: string } }>> {
  const rows = await listStoredWithKeys<GameState & { totalXp?: number; tokenBalance?: number; lastActiveDate?: string }>("game-state", orgId);
  return rows.map(({ key, value }) => ({ email: String(key[0] ?? ""), state: value })).filter((r) => r.email);
}

export async function purchaseStoreItem(orgId: OrgId, email: string, itemId: string, price: number): Promise<{ ok: true; newBalance: number } | { ok: false; error: string }> {
  // NOTE: simple read-modify-write under Firestore (was kv.atomic in the KV
  // version). Race window is acceptable — concurrent purchases of the same
  // item by the same user are rare; worst case is a duplicate in `purchases`
  // which we already dedup against on read.
  const state = await getGameState(orgId, email);
  if (state.purchases?.includes(itemId)) return { ok: false, error: "already purchased" };
  if ((state.tokenBalance ?? 0) < price) return { ok: false, error: "insufficient tokens" };
  state.tokenBalance -= price;
  if (!state.purchases) state.purchases = [];
  state.purchases.push(itemId);
  await saveGameState(orgId, email, state as unknown as Record<string, unknown>);
  return { ok: true, newBalance: state.tokenBalance };
}

// ── Award XP ─────────────────────────────────────────────────────────────────

import { getLevel, LEVEL_THRESHOLDS, AGENT_LEVEL_THRESHOLDS } from "@gamification/domain/business/badge-system/mod.ts";

export async function awardXp(
  orgId: OrgId, email: string, xpAmount: number, role: "reviewer" | "judge" | "manager" | "agent",
): Promise<{ state: FullGameState; xpGained: number; leveledUp: boolean }> {
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
  await saveGameState(orgId, email, state as unknown as Record<string, unknown>);
  const leveledUp = state.level > prevLevel;
  return { state, xpGained: xpAmount, leveledUp };
}
