import { assert } from "#assert";
Deno.test("upload-reaudit — startUploadReaudit export exists", async () => {
  const mod = await import("./mod.ts");
  assert(typeof mod.startUploadReaudit === "function");
});
