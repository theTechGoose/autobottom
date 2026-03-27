import { assertEquals, assertExists } from "jsr:@std/assert";
import { SoundEngine } from "./mod.ts";

Deno.test("SoundEngine: class can be instantiated", () => {
  const engine = new SoundEngine();
  assertExists(engine);
});

Deno.test("SoundEngine: has play method", () => {
  const engine = new SoundEngine();
  assertEquals(typeof engine.play, "function");
});

Deno.test("SoundEngine: has playSlot method", () => {
  const engine = new SoundEngine();
  assertEquals(typeof engine.playSlot, "function");
});

Deno.test("SoundEngine: has setEnabled method", () => {
  const engine = new SoundEngine();
  assertEquals(typeof engine.setEnabled, "function");
});

Deno.test("SoundEngine: has isEnabled method", () => {
  const engine = new SoundEngine();
  assertEquals(typeof engine.isEnabled, "function");
});

Deno.test("SoundEngine: setEnabled(true) then isEnabled() returns true", () => {
  const engine = new SoundEngine();
  engine.setEnabled(true);
  assertEquals(engine.isEnabled(), true);
});

Deno.test("SoundEngine: setEnabled(false) then isEnabled() returns false", () => {
  const engine = new SoundEngine();
  engine.setEnabled(true);
  engine.setEnabled(false);
  assertEquals(engine.isEnabled(), false);
});

Deno.test("SoundEngine: play() with invalid event does not throw", () => {
  const engine = new SoundEngine();
  // Should not throw even when disabled (default)
  engine.play("nonexistent-event");
});

Deno.test("SoundEngine: has init method", () => {
  const engine = new SoundEngine();
  assertEquals(typeof engine.init, "function");
});

Deno.test("SoundEngine: has registerPack method", () => {
  const engine = new SoundEngine();
  assertEquals(typeof engine.registerPack, "function");
});

Deno.test("SoundEngine: has playFile method", () => {
  const engine = new SoundEngine();
  assertEquals(typeof engine.playFile, "function");
});

Deno.test("SoundEngine: has getPacks method", () => {
  const engine = new SoundEngine();
  assertEquals(typeof engine.getPacks, "function");
});

Deno.test("SoundEngine: has getActivePack method", () => {
  const engine = new SoundEngine();
  assertEquals(typeof engine.getActivePack, "function");
});

Deno.test("SoundEngine: isEnabled() defaults to false", () => {
  const engine = new SoundEngine();
  assertEquals(engine.isEnabled(), false);
});

Deno.test("SoundEngine: getActivePack() returns null when no packs configured", () => {
  const engine = new SoundEngine();
  assertEquals(engine.getActivePack(), null);
});

Deno.test("SoundEngine: init() sets pack config", () => {
  const engine = new SoundEngine();
  engine.init({ ping: "mypack" });
  assertEquals(engine.getActivePack(), "mypack");
});

Deno.test("SoundEngine: registerPack() adds to pack registry", () => {
  const engine = new SoundEngine();
  engine.registerPack("testpack", { ping: "/sounds/ping.mp3" });
  const packs = engine.getPacks();
  assertEquals(packs["testpack"]["ping"], "/sounds/ping.mp3");
});
