import { assert } from "#assert";
Deno.test("leaderboard — getLeaderboard exported", async () => {
  const mod = await import("./mod.ts");
  assert(typeof mod.getLeaderboard === "function");
});
