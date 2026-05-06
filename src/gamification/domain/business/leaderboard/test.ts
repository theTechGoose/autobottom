/** Leaderboard sort/filter/empty cases. KV-only; no external side effects. */
import { assert, assertEquals } from "#assert";
import { getLeaderboard } from "./mod.ts";
import { saveGameState } from "@gamification/domain/data/gamification-repository/mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };

function uniqueOrg(): string { return "test-lb-" + crypto.randomUUID().slice(0, 8); }

Deno.test({ name: "leaderboard — empty org returns empty array", ...kvOpts, fn: async () => {
  const ORG = uniqueOrg();
  const out = await getLeaderboard(ORG as any, 10);
  assertEquals(out, []);
}});

Deno.test({ name: "leaderboard — sorts by totalXp desc, ranks 1-N", ...kvOpts, fn: async () => {
  const ORG = uniqueOrg();
  await saveGameState(ORG as any, "alice@x.com", { totalXp: 100, level: 3, dayStreak: 1 });
  await saveGameState(ORG as any, "bob@x.com",   { totalXp: 500, level: 5, dayStreak: 2 });
  await saveGameState(ORG as any, "carol@x.com", { totalXp: 250, level: 4, dayStreak: 0 });

  const out = await getLeaderboard(ORG as any, 10);
  assertEquals(out.length, 3);
  assertEquals(out[0].email, "bob@x.com");   assertEquals(out[0].rank, 1);
  assertEquals(out[1].email, "carol@x.com"); assertEquals(out[1].rank, 2);
  assertEquals(out[2].email, "alice@x.com"); assertEquals(out[2].rank, 3);
}});

Deno.test({ name: "leaderboard — filters out users with 0 XP", ...kvOpts, fn: async () => {
  const ORG = uniqueOrg();
  await saveGameState(ORG as any, "active@x.com", { totalXp: 50, level: 2, dayStreak: 0 });
  await saveGameState(ORG as any, "lurker@x.com", { totalXp: 0, level: 1, dayStreak: 0 });
  await saveGameState(ORG as any, "missing@x.com", { level: 1 });  // no totalXp at all

  const out = await getLeaderboard(ORG as any, 10);
  assertEquals(out.length, 1);
  assertEquals(out[0].email, "active@x.com");
}});

Deno.test({ name: "leaderboard — ties broken by level then email", ...kvOpts, fn: async () => {
  const ORG = uniqueOrg();
  await saveGameState(ORG as any, "z@x.com", { totalXp: 100, level: 3 });
  await saveGameState(ORG as any, "a@x.com", { totalXp: 100, level: 5 });  // higher level wins
  await saveGameState(ORG as any, "m@x.com", { totalXp: 100, level: 3 });  // tied with z; alphabetic m before z

  const out = await getLeaderboard(ORG as any, 10);
  assertEquals(out.map((e) => e.email), ["a@x.com", "m@x.com", "z@x.com"]);
}});

Deno.test({ name: "leaderboard — limit truncates", ...kvOpts, fn: async () => {
  const ORG = uniqueOrg();
  for (let i = 0; i < 12; i++) {
    await saveGameState(ORG as any, `u${i}@x.com`, { totalXp: (i + 1) * 10, level: 1 });
  }
  const out = await getLeaderboard(ORG as any, 5);
  assertEquals(out.length, 5);
  assertEquals(out[0].totalXp, 120);
  assert(out.every((e, i) => e.rank === i + 1));
}});
