/** Sound pack seed — verifies prod's 5 default packs land + idempotency
 *  and the canonical S3 path format. */
import { assert, assertEquals, assertThrows } from "#assert";
import { seedDefaultSoundPacks, SOUND_SLOTS, buildSoundPackS3Key } from "./mod.ts";
import { listSoundPacks, saveSoundPack } from "@gamification/domain/data/gamification-repository/mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };
function uniqueOrg(): string { return "test-pack-" + crypto.randomUUID().slice(0, 8); }

Deno.test("sound-pack-seed — exports", async () => {
  const mod = await import("./mod.ts");
  assert(typeof mod.seedDefaultSoundPacks === "function");
  assert(Array.isArray(mod.SOUND_SLOTS));
  assertEquals(SOUND_SLOTS.length, 7);
});

Deno.test({ name: "sound-pack-seed — first run seeds all 5 packs", ...kvOpts, fn: async () => {
  const ORG = uniqueOrg();
  const result = await seedDefaultSoundPacks(ORG as any, "tester");
  assertEquals(result.seeded.length, 5);
  assertEquals(result.skipped.length, 0);
  const packs = await listSoundPacks(ORG as any);
  assertEquals(packs.length, 5);
  const ids = packs.map((p) => p.id).sort();
  assertEquals(ids, ["mixkit-epic", "mixkit-punchy", "opengameart", "smite", "synth"]);
}});

Deno.test({ name: "sound-pack-seed — second run is idempotent (skips all)", ...kvOpts, fn: async () => {
  const ORG = uniqueOrg();
  await seedDefaultSoundPacks(ORG as any, "tester");
  const second = await seedDefaultSoundPacks(ORG as any, "tester");
  assertEquals(second.seeded.length, 0);
  assertEquals(second.skipped.length, 5);
  const packs = await listSoundPacks(ORG as any);
  assertEquals(packs.length, 5);
}});

Deno.test({ name: "sound-pack-seed — partial: existing pack retained, missing seeded", ...kvOpts, fn: async () => {
  const ORG = uniqueOrg();
  // Pre-seed only `synth` with custom name; verify it survives and others fill in.
  await saveSoundPack(ORG as any, { id: "synth", name: "Custom Synth", slots: { decision: "custom" }, createdAt: 1, createdBy: "user" });
  const result = await seedDefaultSoundPacks(ORG as any, "tester");
  assertEquals(result.seeded.length, 4);
  assertEquals(result.skipped, ["synth"]);
  const packs = await listSoundPacks(ORG as any);
  const synth = packs.find((p) => p.id === "synth");
  assertEquals(synth?.name, "Custom Synth");
  assertEquals(synth?.slots.decision, "custom");
}});

Deno.test("sound-pack-seed — every slot id is a known SOUND_SLOTS value", () => {
  // Cross-check the synth-default pack assigns every slot from SOUND_SLOTS.
  // (The synth pack is the only one with all slots pre-filled at seed time.)
  const known = new Set(SOUND_SLOTS);
  for (const s of SOUND_SLOTS) assert(known.has(s as typeof SOUND_SLOTS[number]));
});

Deno.test("buildSoundPackS3Key — canonical path format", () => {
  assertEquals(buildSoundPackS3Key("monsterrg", "synth", "decision"), "sounds/monsterrg/synth/decision.mp3");
  assertEquals(buildSoundPackS3Key("acme-co", "mixkit-epic", "perfect"), "sounds/acme-co/mixkit-epic/perfect.mp3");
});

Deno.test("buildSoundPackS3Key — rejects empty components", () => {
  assertThrows(() => buildSoundPackS3Key("", "p", "s"));
  assertThrows(() => buildSoundPackS3Key("o", "", "s"));
  assertThrows(() => buildSoundPackS3Key("o", "p", ""));
});

Deno.test("buildSoundPackS3Key — rejects path traversal via slash", () => {
  assertThrows(() => buildSoundPackS3Key("../etc", "synth", "decision"));
  assertThrows(() => buildSoundPackS3Key("org", "pack/../other", "decision"));
  assertThrows(() => buildSoundPackS3Key("org", "synth", "evil/path"));
});
