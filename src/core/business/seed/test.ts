import { assert } from "#assert";
Deno.test("seed — seedOrgData export exists", async () => {
  const mod = await import("./mod.ts");
  assert(typeof mod.seedOrgData === "function");
});
