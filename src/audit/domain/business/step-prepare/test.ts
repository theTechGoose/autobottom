import { assert } from "#assert";
Deno.test("prepare — step function exists", async () => {
  const mod = await import("./mod.ts");
  assert(typeof Object.values(mod)[0] === "function");
});
