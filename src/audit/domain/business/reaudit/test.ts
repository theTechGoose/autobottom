import { assert } from "#assert";
Deno.test("reaudit — startReauditWithGenies export exists", async () => {
  const mod = await import("./mod.ts");
  assert(typeof mod.startReauditWithGenies === "function");
});
