import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ComboMeter } from "./mod.ts";

Deno.test("ComboMeter - default combo is 0", () => {
  const meter = new ComboMeter();
  assertEquals(meter.combo, 0);
});

Deno.test("ComboMeter - default streakThreshold is 0", () => {
  const meter = new ComboMeter();
  assertEquals(meter.streakThreshold, 0);
});

Deno.test("ComboMeter - default timeBank is 0", () => {
  const meter = new ComboMeter();
  assertEquals(meter.timeBank, 0);
});

// comboClass tests
Deno.test("ComboMeter - comboClass returns combo-dim for 0", () => {
  const meter = new ComboMeter();
  meter.combo = 0;
  assertEquals(meter.comboClass, "combo-dim");
});

Deno.test("ComboMeter - comboClass returns combo-dim for negative", () => {
  const meter = new ComboMeter();
  meter.combo = -1;
  assertEquals(meter.comboClass, "combo-dim");
});

Deno.test("ComboMeter - comboClass returns combo-dim for 1-2", () => {
  const meter = new ComboMeter();
  meter.combo = 2;
  assertEquals(meter.comboClass, "combo-dim");
});

Deno.test("ComboMeter - comboClass returns combo-hot for 3-4", () => {
  const meter = new ComboMeter();
  meter.combo = 3;
  assertEquals(meter.comboClass, "combo-hot");
});

Deno.test("ComboMeter - comboClass returns combo-fire for 5-11", () => {
  const meter = new ComboMeter();
  meter.combo = 5;
  assertEquals(meter.comboClass, "combo-fire");
  meter.combo = 11;
  assertEquals(meter.comboClass, "combo-fire");
});

Deno.test("ComboMeter - comboClass returns combo-inferno for 12-22", () => {
  const meter = new ComboMeter();
  meter.combo = 12;
  assertEquals(meter.comboClass, "combo-inferno");
  meter.combo = 22;
  assertEquals(meter.comboClass, "combo-inferno");
});

Deno.test("ComboMeter - comboClass returns combo-godlike for 23+", () => {
  const meter = new ComboMeter();
  meter.combo = 23;
  assertEquals(meter.comboClass, "combo-godlike");
  meter.combo = 100;
  assertEquals(meter.comboClass, "combo-godlike");
});

// showTimeBank tests
Deno.test("ComboMeter - showTimeBank is false when streakThreshold is 0", () => {
  const meter = new ComboMeter();
  meter.streakThreshold = 0;
  assertEquals(meter.showTimeBank, false);
});

Deno.test("ComboMeter - showTimeBank is true when streakThreshold > 0", () => {
  const meter = new ComboMeter();
  meter.streakThreshold = 10;
  assertEquals(meter.showTimeBank, true);
});
