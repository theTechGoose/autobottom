import { assert } from "#assert";
Deno.test("google-sheets — loadSheetsCredentials + appendSheetRows exported", async () => {
  const mod = await import("./mod.ts");
  assert(typeof mod.loadSheetsCredentials === "function");
  assert(typeof mod.appendSheetRows === "function");
});
