import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { WebhookModal } from "./mod.ts";

Deno.test("WebhookModal - default open is false", () => {
  const modal = new WebhookModal();
  assertEquals(modal.open, false);
});

Deno.test("WebhookModal - default kind is 'terminate'", () => {
  const modal = new WebhookModal();
  assertEquals(modal.kind, "terminate");
});

Deno.test("WebhookModal - default postUrl is empty string", () => {
  const modal = new WebhookModal();
  assertEquals(modal.postUrl, "");
});

Deno.test("WebhookModal - default headers is empty string", () => {
  const modal = new WebhookModal();
  assertEquals(modal.headers, "");
});

Deno.test("WebhookModal - default cache is empty object", () => {
  const modal = new WebhookModal();
  assertEquals(modal.cache, {});
});

Deno.test("WebhookModal - default saving is false", () => {
  const modal = new WebhookModal();
  assertEquals(modal.saving, false);
});

Deno.test("WebhookModal - has loadTab method", () => {
  const modal = new WebhookModal();
  assertEquals(typeof modal.loadTab, "function");
});

Deno.test("WebhookModal - has save method", () => {
  const modal = new WebhookModal();
  assertEquals(typeof modal.save, "function");
});
