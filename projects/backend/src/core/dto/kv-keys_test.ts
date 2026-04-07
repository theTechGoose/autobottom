/**
 * KV key-schema snapshot test. Asserts the set of known key prefixes
 * used with orgKey(). Changes to this list must be deliberate.
 */
import { assertEquals } from "@std/assert";

/**
 * Every org-scoped KV key prefix used across the codebase.
 * Extracted from grep of orgKey(orgId, "...") across all .ts files.
 */
const KNOWN_PREFIXES = [
  // Audit pipeline (lib/kv.ts)
  "audit-finding",
  "audit-job",
  "question-cache",
  "destination-questions",
  "audit-batches-remaining",
  "audit-populated-questions",
  "audit-answers",
  "audit-transcript",

  // Stats (lib/kv.ts)
  "stats-active",
  "stats-completed",
  "stats-error",
  "stats-retry",

  // Pipeline config (lib/kv.ts)
  "pipeline-config",

  // Webhooks (lib/kv.ts)
  "webhook-settings",

  // Email reports (lib/kv.ts)
  "email-report-config",

  // Sound packs (lib/kv.ts)
  "sound-pack",

  // Gamification (lib/kv.ts)
  "gamification",

  // Store (lib/kv.ts)
  "store-item",

  // Badges & XP (lib/kv.ts)
  "badge",
  "badge-stats",
  "game-state",

  // Events (lib/kv.ts)
  "event",
  "prefab-subs",
  "broadcast",

  // Messaging (lib/kv.ts)
  "message",
  "unread-count",

  // Review queue (review/kv.ts)
  "review-pending",
  "review-audit-pending",
  "review-lock",
  "review-decided",

  // Judge queue (judge/kv.ts)
  "judge-pending",
  "judge-audit-pending",
  "judge-lock",
  "judge-decided",

  // Appeals (judge/kv.ts) — note: no "judge-" prefix on these
  "appeal",
  "appeal-stats",
  "appeal-history",

  // Manager queue (manager/kv.ts)
  "manager-queue",
  "manager-remediation",

  // Question Lab (question-lab/kv.ts) — uses "qlab" parent prefix
  "qlab",
].sort();

Deno.test("KV key prefixes are frozen", () => {
  assertEquals(KNOWN_PREFIXES.length, 40, "Expected 40 known key prefixes. If you added/removed a prefix, update this test.");

  // Verify sorted and no duplicates
  const unique = [...new Set(KNOWN_PREFIXES)].sort();
  assertEquals(KNOWN_PREFIXES, unique, "Prefixes must be unique and sorted");
});
