/** Resolve equipped cosmetics from a GameState against the STORE_CATALOG.
 *  Pure functions, server- AND client-safe (catalog is statically imported
 *  from @gamification/domain/business/badge-system).
 *
 *  GameState shape on disk is loose JSON — fields like `equippedTitle`,
 *  `equippedNameColor`, `equippedFrame`, `equippedFlair` may be absent on
 *  older docs. Every helper here returns a safe default for missing fields. */

import { STORE_CATALOG } from "@gamification/domain/business/badge-system/mod.ts";

/** Loose shape — any object that *might* carry equipped-cosmetic IDs. The
 *  cosmetics resolver tolerates missing fields and unknown extras so it can
 *  be called with `GameState | LeaderboardEntry | Record<string, unknown>`
 *  without TS index-signature friction at every call site. */
type AnyState = Record<string, unknown> | null | undefined;

function readId(state: AnyState, key: string): string | null {
  if (!state) return null;
  const v = (state as Record<string, unknown>)[key];
  return typeof v === "string" ? v : null;
}

function findItem(id: string | null) {
  if (!id) return undefined;
  return STORE_CATALOG.find((i) => i.id === id);
}

/** Human-readable equipped title, or null. */
export function equippedTitle(state: AnyState): string | null {
  const item = findItem(readId(state, "equippedTitle"));
  return item?.name ?? null;
}

/** CSS color value for the equipped name color. Returns `currentColor` when
 *  nothing is equipped so the caller can plain-render without conditionals. */
export function equippedNameColor(state: AnyState): string {
  const item = findItem(readId(state, "equippedNameColor"));
  // STORE_CATALOG name_color items carry the CSS color in `preview`.
  return (item?.preview as string | undefined) ?? "currentColor";
}

/** CSS style fragment for the avatar frame ring. Empty string when none. */
export function equippedFrameStyle(state: AnyState): string {
  const item = findItem(readId(state, "equippedFrame"));
  const color = (item?.preview as string | undefined) ?? "";
  if (!color) return "";
  // Box-shadow ring keeps things zero-layout-impact and works at any avatar size.
  return `box-shadow:0 0 0 2px ${color}, 0 0 12px ${color}66;`;
}

/** Emoji or symbol for the equipped flair. Returns null when none. */
export function equippedFlair(state: AnyState): string | null {
  const item = findItem(readId(state, "equippedFlair"));
  // Flair items carry the displayable glyph in `icon`.
  return item?.icon ?? null;
}

/** Resolve all four equipped cosmetics in one shot — handy for rendering
 *  user cards / chat senders / leaderboard rows where you want everything. */
export function resolveCosmetics(state: unknown) {
  const s = (state ?? null) as AnyState;
  return {
    title: equippedTitle(s),
    nameColor: equippedNameColor(s),
    frameStyle: equippedFrameStyle(s),
    flair: equippedFlair(s),
  };
}
