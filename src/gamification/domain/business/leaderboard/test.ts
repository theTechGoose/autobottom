/** Leaderboard sort/filter/empty cases. KV-only; no external side effects. */
import { assert, assertEquals } from "#assert";
import { getLeaderboard } from "./mod.ts";
import { saveGameState } from "@gamification/domain/data/gamification-repository/mod.ts";
import { createUser } from "@core/business/auth/mod.ts";
import type { Role } from "@core/business/auth/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };

function uniqueOrg(): string { return "test-lb-" + crypto.randomUUID().slice(0, 8); }

/** Helper: create an agent (role="user") + game state in one call. */
async function seedAgent(org: string, email: string, state: Record<string, unknown>, role: Role = "user") {
  await createUser(org as OrgId, email, "pw", role);
  await saveGameState(org as OrgId, email, state);
}

Deno.test({ name: "leaderboard — empty org returns empty array", ...kvOpts, fn: async () => {
  const ORG = uniqueOrg();
  const out = await getLeaderboard(ORG as any, 10);
  assertEquals(out, []);
}});

Deno.test({ name: "leaderboard — sorts by totalXp desc, ranks 1-N", ...kvOpts, fn: async () => {
  const ORG = uniqueOrg();
  await seedAgent(ORG, "alice@x.com", { totalXp: 100, level: 3, dayStreak: 1 });
  await seedAgent(ORG, "bob@x.com",   { totalXp: 500, level: 5, dayStreak: 2 });
  await seedAgent(ORG, "carol@x.com", { totalXp: 250, level: 4, dayStreak: 0 });

  const out = await getLeaderboard(ORG as any, 10);
  assertEquals(out.length, 3);
  assertEquals(out[0].email, "bob@x.com");   assertEquals(out[0].rank, 1);
  assertEquals(out[1].email, "carol@x.com"); assertEquals(out[1].rank, 2);
  assertEquals(out[2].email, "alice@x.com"); assertEquals(out[2].rank, 3);
}});

Deno.test({ name: "leaderboard — filters out users with 0 XP", ...kvOpts, fn: async () => {
  const ORG = uniqueOrg();
  await seedAgent(ORG, "active@x.com", { totalXp: 50, level: 2, dayStreak: 0 });
  await seedAgent(ORG, "lurker@x.com", { totalXp: 0, level: 1, dayStreak: 0 });
  await seedAgent(ORG, "missing@x.com", { level: 1 });  // no totalXp at all

  const out = await getLeaderboard(ORG as any, 10);
  assertEquals(out.length, 1);
  assertEquals(out[0].email, "active@x.com");
}});

Deno.test({ name: "leaderboard — ties broken by level then email", ...kvOpts, fn: async () => {
  const ORG = uniqueOrg();
  await seedAgent(ORG, "z@x.com", { totalXp: 100, level: 3 });
  await seedAgent(ORG, "a@x.com", { totalXp: 100, level: 5 });  // higher level wins
  await seedAgent(ORG, "m@x.com", { totalXp: 100, level: 3 });  // tied with z; alphabetic m before z

  const out = await getLeaderboard(ORG as any, 10);
  assertEquals(out.map((e) => e.email), ["a@x.com", "m@x.com", "z@x.com"]);
}});

Deno.test({ name: "leaderboard — limit truncates", ...kvOpts, fn: async () => {
  const ORG = uniqueOrg();
  for (let i = 0; i < 12; i++) {
    await seedAgent(ORG, `u${i}@x.com`, { totalXp: (i + 1) * 10, level: 1 });
  }
  const out = await getLeaderboard(ORG as any, 5);
  assertEquals(out.length, 5);
  assertEquals(out[0].totalXp, 120);
  assert(out.every((e, i) => e.rank === i + 1));
}});

Deno.test({ name: "leaderboard — excludes admin, manager, judge, reviewer, and orphan game-states", ...kvOpts, fn: async () => {
  const ORG = uniqueOrg();
  await seedAgent(ORG, "agent@x.com", { totalXp: 50, level: 2 }, "user");
  await seedAgent(ORG, "boss@x.com",  { totalXp: 999, level: 9 }, "admin");
  await seedAgent(ORG, "mgr@x.com",   { totalXp: 800, level: 8 }, "manager");
  await seedAgent(ORG, "judge@x.com", { totalXp: 700, level: 7 }, "judge");
  await seedAgent(ORG, "rev@x.com",   { totalXp: 600, level: 6 }, "reviewer");
  // Orphan game-state with no matching user record (e.g. legacy "api" key).
  await saveGameState(ORG as any, "api", { totalXp: 9999, level: 99 });

  const out = await getLeaderboard(ORG as any, 10);
  assertEquals(out.length, 1);
  assertEquals(out[0].email, "agent@x.com");
}});
