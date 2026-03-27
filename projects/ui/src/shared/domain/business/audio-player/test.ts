import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AudioPlayer } from "./mod.ts";

// --- Default property values ---

Deno.test("AudioPlayer - default src is empty string", () => {
  const player = new AudioPlayer();
  assertEquals(player.src, "");
});

// --- State defaults ---

Deno.test("AudioPlayer - default playing is false", () => {
  const player = new AudioPlayer();
  assertEquals(player.playing, false);
});

Deno.test("AudioPlayer - default currentTime is '0:00'", () => {
  const player = new AudioPlayer();
  assertEquals(player.currentTime, "0:00");
});

Deno.test("AudioPlayer - default fillPct is 0", () => {
  const player = new AudioPlayer();
  assertEquals(player.fillPct, 0);
});

// --- Methods ---

Deno.test("AudioPlayer - toggle flips playing from false to true", () => {
  const player = new AudioPlayer();
  player.toggle();
  assertEquals(player.playing, true);
});

Deno.test("AudioPlayer - toggle flips playing from true to false", () => {
  const player = new AudioPlayer();
  player.playing = true;
  player.toggle();
  assertEquals(player.playing, false);
});

Deno.test("AudioPlayer - toggle called twice returns to original state", () => {
  const player = new AudioPlayer();
  player.toggle();
  player.toggle();
  assertEquals(player.playing, false);
});

Deno.test("AudioPlayer - formatTime formats 0 seconds", () => {
  const player = new AudioPlayer();
  assertEquals(player.formatTime(0), "0:00");
});

Deno.test("AudioPlayer - formatTime formats 5 seconds", () => {
  const player = new AudioPlayer();
  assertEquals(player.formatTime(5), "0:05");
});

Deno.test("AudioPlayer - formatTime formats 65 seconds as 1:05", () => {
  const player = new AudioPlayer();
  assertEquals(player.formatTime(65), "1:05");
});

Deno.test("AudioPlayer - formatTime formats 600 seconds as 10:00", () => {
  const player = new AudioPlayer();
  assertEquals(player.formatTime(600), "10:00");
});

Deno.test("AudioPlayer - formatTime formats 61.7 seconds as 1:01", () => {
  const player = new AudioPlayer();
  assertEquals(player.formatTime(61.7), "1:01");
});

Deno.test("AudioPlayer - formatTime formats 9 seconds with leading zero", () => {
  const player = new AudioPlayer();
  assertEquals(player.formatTime(9), "0:09");
});

Deno.test("AudioPlayer - formatTime formats 10 seconds without leading zero", () => {
  const player = new AudioPlayer();
  assertEquals(player.formatTime(10), "0:10");
});

// --- onTimeUpdate ---

Deno.test("AudioPlayer - onTimeUpdate updates currentTime and fillPct", () => {
  const player = new AudioPlayer();
  player.onTimeUpdate(30, 120);
  assertEquals(player.currentTime, "0:30/2:00");
  assertEquals(player.fillPct, 25);
});

Deno.test("AudioPlayer - onTimeUpdate at zero duration keeps fillPct at 0", () => {
  const player = new AudioPlayer();
  player.onTimeUpdate(10, 0);
  assertEquals(player.currentTime, "0:10/0:00");
  assertEquals(player.fillPct, 0);
});

Deno.test("AudioPlayer - onTimeUpdate at end of track", () => {
  const player = new AudioPlayer();
  player.onTimeUpdate(60, 60);
  assertEquals(player.currentTime, "1:00/1:00");
  assertEquals(player.fillPct, 100);
});
