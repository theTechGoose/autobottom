import { assert } from "#assert";
Deno.test("google-sheets — readSheetsCredentials exported", async () => {
  const mod = await import("./mod.ts");
  assert(typeof mod.readSheetsCredentials === "function");
  assert(typeof mod.appendSheetRows === "function");
});
