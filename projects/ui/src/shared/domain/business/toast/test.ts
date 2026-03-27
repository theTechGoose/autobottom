import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Toast } from "./mod.ts";

Deno.test("Toast - default msg is empty string", () => {
  const toast = new Toast();
  assertEquals(toast.msg, "");
});

Deno.test("Toast - default type is info", () => {
  const toast = new Toast();
  assertEquals(toast.type, "info");
});

Deno.test("Toast - default visible is true", () => {
  const toast = new Toast();
  assertEquals(toast.visible, true);
});

Deno.test("Toast - dismiss sets visible to false", () => {
  const toast = new Toast();
  assertEquals(toast.visible, true);
  toast.dismiss();
  assertEquals(toast.visible, false);
});

Deno.test("Toast - type can be set to success", () => {
  const toast = new Toast();
  toast.type = "success";
  assertEquals(toast.type, "success");
});

Deno.test("Toast - type can be set to error", () => {
  const toast = new Toast();
  toast.type = "error";
  assertEquals(toast.type, "error");
});

Deno.test("Toast - msg can be set", () => {
  const toast = new Toast();
  toast.msg = "Operation completed";
  assertEquals(toast.msg, "Operation completed");
});
