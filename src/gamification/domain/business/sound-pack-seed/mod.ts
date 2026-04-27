/** Default sound pack metadata — ports prod's 5 packs (synth / smite /
 *  opengameart / mixkit-punchy / mixkit-epic). Sound files themselves still
 *  need to be uploaded to S3 separately; this module just seeds the metadata
 *  records so the gamification UI shows them and an admin can wire slots. */

import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { saveSoundPack, getSoundPack, type SoundPackMeta } from "@gamification/domain/data/gamification-repository/mod.ts";

export const SOUND_SLOTS = [
  "decision",       // any review/judge decision
  "perfect",        // perfect-score celebration
  "level-up",       // level-up jingle
  "badge-earned",   // new badge
  "purchase",       // store purchase
  "combo-3",        // 3-combo streak
  "combo-5",        // 5-combo streak
] as const;

const DEFAULT_PACKS: Array<Pick<SoundPackMeta, "id" | "name" | "slots">> = [
  {
    id: "synth",
    name: "Synth (built-in)",
    slots: {
      decision: "synth",
      perfect: "synth",
      "level-up": "synth",
      "badge-earned": "synth",
      purchase: "synth",
      "combo-3": "synth",
      "combo-5": "synth",
    },
  },
  { id: "smite",          name: "Smite",         slots: {} },
  { id: "opengameart",    name: "Open Game Art", slots: {} },
  { id: "mixkit-punchy",  name: "Mixkit Punchy", slots: {} },
  { id: "mixkit-epic",    name: "Mixkit Epic",   slots: {} },
];

/** Seeds the 5 default packs. Idempotent — existing packs are not overwritten. */
export async function seedDefaultSoundPacks(
  orgId: OrgId,
  createdBy: string,
): Promise<{ seeded: string[]; skipped: string[] }> {
  const seeded: string[] = [];
  const skipped: string[] = [];
  for (const p of DEFAULT_PACKS) {
    const existing = await getSoundPack(orgId, p.id);
    if (existing) { skipped.push(p.id); continue; }
    await saveSoundPack(orgId, { ...p, createdAt: Date.now(), createdBy });
    seeded.push(p.id);
  }
  return { seeded, skipped };
}
