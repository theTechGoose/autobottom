import { assertEquals } from "@std/assert";
import { Combometer } from "./mod.ts";
import type { ComboEvent } from "./mod.ts";

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

Deno.test("Combometer: initial combo is -1", () => {
  const c = new Combometer({ baseMs: 0, bankPerEvent: 0, maxBankMs: 0 });
  assertEquals(c.combo, -1);
  c.destroy();
});

Deno.test("Combometer: initial bankRemaining is 0", () => {
  const c = new Combometer({ baseMs: 0, bankPerEvent: 0, maxBankMs: 0 });
  assertEquals(c.bankRemaining, 0);
  c.destroy();
});

// ---------------------------------------------------------------------------
// tick increments combo
// ---------------------------------------------------------------------------

Deno.test("Combometer: first tick moves combo from -1 to 0", () => {
  const c = new Combometer({ baseMs: 0, bankPerEvent: 0, maxBankMs: 0 });
  c.tick();
  assertEquals(c.combo, 0);
  c.destroy();
});

Deno.test("Combometer: subsequent ticks increment combo", () => {
  const c = new Combometer({ baseMs: 0, bankPerEvent: 0, maxBankMs: 0 });
  c.tick();
  c.tick();
  c.tick();
  assertEquals(c.combo, 2);
  c.destroy();
});

// ---------------------------------------------------------------------------
// Observer fires with correct event shape
// ---------------------------------------------------------------------------

Deno.test("Combometer: observer receives correct previous and new on first tick", () => {
  const c = new Combometer({ baseMs: 0, bankPerEvent: 0, maxBankMs: 0 });
  const events: ComboEvent[] = [];
  const unsub = c.observe((e) => events.push(e));
  c.tick("hello");
  unsub();
  c.destroy();

  assertEquals(events.length, 1);
  assertEquals(events[0].previous, -1);
  assertEquals(events[0].new, 0);
  assertEquals(events[0].data, "hello");
});

Deno.test("Combometer: observer receives null data when tick called without argument", () => {
  const c = new Combometer({ baseMs: 0, bankPerEvent: 0, maxBankMs: 0 });
  const events: ComboEvent[] = [];
  const unsub = c.observe((e) => events.push(e));
  c.tick();
  unsub();
  c.destroy();

  assertEquals(events[0].data, null);
});

Deno.test("Combometer: observer receives incrementing combo across ticks", () => {
  const c = new Combometer({ baseMs: 0, bankPerEvent: 0, maxBankMs: 0 });
  const events: ComboEvent[] = [];
  const unsub = c.observe((e) => events.push(e));
  c.tick();
  c.tick();
  c.tick();
  unsub();
  c.destroy();

  assertEquals(events[0].previous, -1);
  assertEquals(events[0].new, 0);
  assertEquals(events[1].previous, 0);
  assertEquals(events[1].new, 1);
  assertEquals(events[2].previous, 1);
  assertEquals(events[2].new, 2);
});

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

Deno.test("Combometer: reset brings combo back to -1", () => {
  const c = new Combometer({ baseMs: 0, bankPerEvent: 0, maxBankMs: 0 });
  c.tick();
  c.tick();
  c.reset();
  assertEquals(c.combo, -1);
  c.destroy();
});

Deno.test("Combometer: reset fires drop event with correct previous", () => {
  const c = new Combometer({ baseMs: 0, bankPerEvent: 0, maxBankMs: 0 });
  const events: ComboEvent[] = [];
  c.tick();
  c.tick(); // combo is now 1
  const unsub = c.observe((e) => events.push(e));
  c.reset();
  unsub();
  c.destroy();

  assertEquals(events.length, 1);
  assertEquals(events[0].previous, 1);
  assertEquals(events[0].new, -1);
  assertEquals(events[0].data, null);
});

Deno.test("Combometer: reset does not fire when already at -1", () => {
  const c = new Combometer({ baseMs: 0, bankPerEvent: 0, maxBankMs: 0 });
  const events: ComboEvent[] = [];
  const unsub = c.observe((e) => events.push(e));
  c.reset(); // already -1, should not fire
  unsub();
  c.destroy();

  assertEquals(events.length, 0);
});

// ---------------------------------------------------------------------------
// observe / unsubscribe
// ---------------------------------------------------------------------------

Deno.test("Combometer: unsubscribe stops receiving events", () => {
  const c = new Combometer({ baseMs: 0, bankPerEvent: 0, maxBankMs: 0 });
  const events: ComboEvent[] = [];
  const unsub = c.observe((e) => events.push(e));
  c.tick();
  unsub();
  c.tick(); // this should not reach the observer
  c.destroy();

  assertEquals(events.length, 1);
});

// ---------------------------------------------------------------------------
// consume
// ---------------------------------------------------------------------------

Deno.test("Combometer: consume routes to correct tier", () => {
  const c = new Combometer({ baseMs: 0, bankPerEvent: 0, maxBankMs: 0 });
  const tier0Events: ComboEvent[] = [];
  const tier1Events: ComboEvent[] = [];
  const dropEvents: ComboEvent[] = [];

  const unsub = c.consume({
    onDrop: (e) => dropEvents.push(e),
    tiers: [
      (e) => tier0Events.push(e),
      (e) => tier1Events.push(e),
    ],
  });

  c.tick(); // combo 0 → tier 0
  c.tick(); // combo 1 → tier 1
  c.tick(); // combo 2 → clamped to tier 1 (last index)
  unsub();
  c.destroy();

  assertEquals(tier0Events.length, 1);
  assertEquals(tier0Events[0].new, 0);

  assertEquals(tier1Events.length, 2);
  assertEquals(tier1Events[0].new, 1);
  assertEquals(tier1Events[1].new, 2);

  assertEquals(dropEvents.length, 0);
});

Deno.test("Combometer: consume routes drop event to onDrop", () => {
  const c = new Combometer({ baseMs: 0, bankPerEvent: 0, maxBankMs: 0 });
  const dropEvents: ComboEvent[] = [];

  const unsub = c.consume({
    onDrop: (e) => dropEvents.push(e),
    tiers: [() => {}],
  });

  c.tick();
  c.reset(); // triggers drop
  unsub();
  c.destroy();

  assertEquals(dropEvents.length, 1);
  assertEquals(dropEvents[0].new, -1);
});

// ---------------------------------------------------------------------------
// destroy
// ---------------------------------------------------------------------------

Deno.test("Combometer: destroy clears all observers (no events after destroy)", () => {
  const c = new Combometer({ baseMs: 0, bankPerEvent: 0, maxBankMs: 0 });
  const events: ComboEvent[] = [];
  c.observe((e) => events.push(e));
  c.destroy();
  // After destroy, observers are cleared — tick will still change combo but no callbacks
  c.tick();
  assertEquals(events.length, 0);
});

// ---------------------------------------------------------------------------
// bankRemaining with baseMs = 0
// ---------------------------------------------------------------------------

Deno.test("Combometer: bankRemaining is 0 when baseMs is 0 regardless of combo", () => {
  const c = new Combometer({ baseMs: 0, bankPerEvent: 0, maxBankMs: 0 });
  c.tick();
  c.tick();
  assertEquals(c.bankRemaining, 0);
  c.destroy();
});

// ---------------------------------------------------------------------------
// bankRemaining with combo < 0
// ---------------------------------------------------------------------------

Deno.test("Combometer: bankRemaining is 0 when combo is -1 even with nonzero baseMs", () => {
  const c = new Combometer({ baseMs: 5000, bankPerEvent: 100, maxBankMs: 0 });
  // combo is -1 initially
  assertEquals(c.bankRemaining, 0);
  c.destroy();
});
