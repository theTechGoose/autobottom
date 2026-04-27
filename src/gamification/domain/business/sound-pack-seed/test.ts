import { assert } from "#assert";
Deno.test("sound-pack-seed — exports seedDefaultSoundPacks + SOUND_SLOTS", async () => {
  const mod = await import("./mod.ts");
  assert(typeof mod.seedDefaultSoundPacks === "function");
  assert(Array.isArray(mod.SOUND_SLOTS));
  assert(mod.SOUND_SLOTS.length > 0);
});
