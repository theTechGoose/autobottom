import { assertEquals } from "jsr:@std/assert";
import type { QueueItem } from "./queue-item.ts";
import type { Transcript } from "./transcript.ts";
import type { GameConfig } from "./game-config.ts";
import type { GameState } from "./game-state.ts";
import type {
  StoreItem,
  StoreData,
} from "./store-item.ts";
import type { User } from "./user.ts";
import type { ToastMsg } from "./toast.ts";

// Re-import constants as values (not just types)
import {
  REVIEWER_LEVEL_THRESHOLDS as reviewerThresholds,
  MANAGER_LEVEL_THRESHOLDS as managerThresholds,
  STREAKS as streaks,
  SKIP_TIERS as skipTiers,
} from "./game-config.ts";
import {
  RARITY_LABELS as rarityLabels,
  TIER_COLORS as tierColors,
  CATEGORY_META as categoryMeta,
} from "./store-item.ts";
import {
  ROLE_COLORS as roleColors,
  ROLE_INITIALS as roleInitials,
  ROLE_REDIRECTS as roleRedirects,
} from "./user.ts";

// ---------- Type-level checks via assignment ----------

Deno.test("QueueItem interface is usable", () => {
  const item: QueueItem = {
    findingId: "f1",
    questionIndex: 0,
    header: "h",
    populated: "p",
    defense: "d",
  };
  assertEquals(item.findingId, "f1");
});

Deno.test("Transcript interface is usable", () => {
  const t: Transcript = { diarized: "d", raw: "r" };
  assertEquals(typeof t.diarized, "string");
});

Deno.test("GameConfig interface is usable", () => {
  const gc: GameConfig = { threshold: 10, enabled: true };
  assertEquals(gc.threshold, 10);
});

Deno.test("GameState interface is usable", () => {
  const gs: GameState = { level: 1, totalXp: 0, tokenBalance: 0, badges: [] };
  assertEquals(gs.level, 1);
});

Deno.test("StoreItem interface is usable", () => {
  const si: StoreItem = {
    id: "1",
    name: "n",
    type: "badge",
    icon: "i",
    price: 100,
  };
  assertEquals(si.price, 100);
});

Deno.test("StoreData interface is usable", () => {
  const sd: StoreData = { items: [], balance: 0, purchased: [] };
  assertEquals(sd.items.length, 0);
});

Deno.test("User interface is usable", () => {
  const u: User = { role: "admin" };
  assertEquals(u.role, "admin");
});

Deno.test("ToastMsg interface is usable", () => {
  const t: ToastMsg = { id: 1, msg: "hi", type: "success" };
  assertEquals(t.type, "success");
});

// ---------- Constant checks ----------

Deno.test("REVIEWER_LEVEL_THRESHOLDS is sorted ascending", () => {
  for (let i = 1; i < reviewerThresholds.length; i++) {
    assertEquals(
      reviewerThresholds[i] > reviewerThresholds[i - 1],
      true,
      `Index ${i}: ${reviewerThresholds[i]} should be > ${reviewerThresholds[i - 1]}`,
    );
  }
});

Deno.test("MANAGER_LEVEL_THRESHOLDS is sorted ascending", () => {
  for (let i = 1; i < managerThresholds.length; i++) {
    assertEquals(
      managerThresholds[i] > managerThresholds[i - 1],
      true,
      `Index ${i}: ${managerThresholds[i]} should be > ${managerThresholds[i - 1]}`,
    );
  }
});

Deno.test("STREAKS are sorted by at field ascending", () => {
  for (let i = 1; i < streaks.length; i++) {
    assertEquals(
      streaks[i].at > streaks[i - 1].at,
      true,
      `Index ${i}: ${streaks[i].at} should be > ${streaks[i - 1].at}`,
    );
  }
});

Deno.test("SKIP_TIERS has expected values", () => {
  assertEquals(skipTiers.length, 3);
  assertEquals(skipTiers[0], 1);
  assertEquals(skipTiers[1], 5);
  assertEquals(skipTiers[2], 10);
});

Deno.test("TIER_COLORS and RARITY_LABELS have matching keys", () => {
  const tierKeys = Object.keys(tierColors).sort();
  const rarityKeys = Object.keys(rarityLabels).sort();
  assertEquals(tierKeys, rarityKeys);
});

Deno.test("ROLE_COLORS has expected keys", () => {
  const keys = Object.keys(roleColors).sort();
  assertEquals(keys, ["admin", "judge", "manager", "reviewer", "user"]);
});

Deno.test("ROLE_INITIALS has same keys as ROLE_COLORS", () => {
  const colorKeys = Object.keys(roleColors).sort();
  const initialKeys = Object.keys(roleInitials).sort();
  assertEquals(colorKeys, initialKeys);
});

Deno.test("ROLE_REDIRECTS has same keys as ROLE_COLORS", () => {
  const colorKeys = Object.keys(roleColors).sort();
  const redirectKeys = Object.keys(roleRedirects).sort();
  assertEquals(colorKeys, redirectKeys);
});

Deno.test("CATEGORY_META has expected keys", () => {
  const keys = Object.keys(categoryMeta).sort();
  assertEquals(keys, ["avatar_frame", "badge", "effect", "sound", "title"]);
});

Deno.test("CATEGORY_META values have label and description", () => {
  for (const [key, val] of Object.entries(categoryMeta)) {
    assertEquals(typeof val.label, "string", `${key} missing label`);
    assertEquals(typeof val.description, "string", `${key} missing description`);
  }
});
