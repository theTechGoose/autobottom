import { assertEquals } from "jsr:@std/assert";
import { SlotUploadRow } from "./mod.ts";

Deno.test("SlotUploadRow - can be instantiated", () => {
  const comp = new SlotUploadRow();
  assertEquals(comp instanceof SlotUploadRow, true);
});

Deno.test("SlotUploadRow - default slot is empty string", () => {
  const comp = new SlotUploadRow();
  assertEquals(comp.slot, "");
});

Deno.test("SlotUploadRow - default url is empty string", () => {
  const comp = new SlotUploadRow();
  assertEquals(comp.url, "");
});

Deno.test("SlotUploadRow - default uploading is false", () => {
  const comp = new SlotUploadRow();
  assertEquals(comp.uploading, false);
});

Deno.test("SlotUploadRow - has upload method", () => {
  const comp = new SlotUploadRow();
  assertEquals(typeof comp.upload, "function");
});
