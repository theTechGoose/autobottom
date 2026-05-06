import { assert } from "#assert";
Deno.test("poll-transcript — step function exists", async () => {
  const mod = await import("./mod.ts");
  assert(typeof Object.values(mod)[0] === "function");
});
