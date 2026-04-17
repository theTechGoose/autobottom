import { assert } from "#assert";
Deno.test("file-appeal — fileJudgeAppeal export exists", async () => {
  const mod = await import("./mod.ts");
  assert(typeof mod.fileJudgeAppeal === "function");
});
