import { assertEquals } from "@std/assert";
import { WebhookConfigSchema, WebhookKindSchema } from "./webhook.ts";

Deno.test("WebhookKind schema snapshot — all values", () => {
  for (const kind of ["terminate", "appeal", "manager", "judge"] as const) {
    assertEquals(WebhookKindSchema.parse(kind), kind);
  }
});

Deno.test("WebhookConfig schema snapshot — no headers", () => {
  const fixture = {
    postUrl: "https://example.com/webhook",
    postHeaders: {},
  };
  const parsed = WebhookConfigSchema.parse(fixture);
  assertEquals(parsed, fixture);
});

Deno.test("WebhookConfig schema snapshot — with headers", () => {
  const fixture = {
    postUrl: "https://api.example.com/events",
    postHeaders: {
      "Authorization": "Bearer token123",
      "Content-Type": "application/json",
    },
  };
  const parsed = WebhookConfigSchema.parse(fixture);
  assertEquals(parsed, fixture);
});
