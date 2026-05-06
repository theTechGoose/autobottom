import { assertEquals } from "#assert";
import { IndexPageBuilder } from "./mod.ts";

Deno.test("IndexPageBuilder builds HTML with module links", () => {
  const builder = new IndexPageBuilder({ prefix: "/docs/" });
  const html = builder.build(["AuditModule", "ReviewModule"]);
  assertEquals(html.includes("<a href=\"/docs/audit\">Audit</a>"), true);
  assertEquals(html.includes("<a href=\"/docs/review\">Review</a>"), true);
});
