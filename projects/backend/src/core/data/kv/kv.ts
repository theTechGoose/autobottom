/**
 * Kv singleton class — compatibility shim for coordinator modules that use the
 * class-based `Kv.getInstance()` / `Kv.orgKey()` pattern.
 *
 * Delegates all work to the standalone functions in `./impl.ts` and `./org.ts`.
 */

import { kvFactory } from "./factory.ts";
import { orgKey } from "./org.ts";
import type { OrgId } from "./org.ts";
import {
  getFinding,
  saveFinding,
  getAllAnswersForFinding,
  getTranscript,
  saveTranscript,
  getBadgeStats,
  updateBadgeStats,
  getEarnedBadges,
  awardBadge,
  awardXp,
  fireWebhook,
  checkAndEmitPrefab,
} from "./impl.ts";

let _instance: Kv | undefined;

export class Kv {
  readonly db: Deno.Kv;

  private constructor(db: Deno.Kv) {
    this.db = db;
  }

  static async getInstance(): Promise<Kv> {
    if (!_instance) {
      const db = await kvFactory();
      _instance = new Kv(db);
    }
    return _instance;
  }

  static orgKey(orgId: OrgId, ...parts: Deno.KvKeyPart[]): Deno.KvKey {
    return orgKey(orgId, ...parts);
  }

  // -- Delegating instance methods --

  getFinding = getFinding;
  saveFinding = saveFinding;
  getAllAnswersForFinding = getAllAnswersForFinding;
  getTranscript = getTranscript;
  saveTranscript = saveTranscript;
  getBadgeStats = getBadgeStats;
  updateBadgeStats = updateBadgeStats;
  getEarnedBadges = getEarnedBadges;
  awardBadge = awardBadge;
  awardXp = awardXp;
  fireWebhook = fireWebhook;
  checkAndEmitPrefab = checkAndEmitPrefab;
}
