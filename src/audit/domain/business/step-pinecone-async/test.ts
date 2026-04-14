import { assert } from "#assert";
Deno.test("pinecone-async — step function exists", async () => {
  const mod = await import("./mod.ts");
  assert(typeof Object.values(mod)[0] === "function");
});
