/** Smoke tests for email report config + template repository. */

import { assertEquals, assert } from "#assert";
import {
  listEmailReportConfigs, getEmailReportConfig, saveEmailReportConfig, deleteEmailReportConfig,
  listEmailTemplates, getEmailTemplate, saveEmailTemplate, deleteEmailTemplate,
  getEmailReportPreview, saveEmailReportPreview, deleteEmailReportPreview,
  getReportLastFired, setReportLastFired,
} from "./mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };
const ORG = "test-org-" + crypto.randomUUID().slice(0, 8);

Deno.test({ name: "email report config — save, get, list, delete", ...kvOpts, fn: async () => {
  const saved = await saveEmailReportConfig(ORG, { name: "Weekly", recipients: ["a@b.com"], reportSections: [] });
  assert(saved.id);
  assertEquals(saved.name, "Weekly");

  const got = await getEmailReportConfig(ORG, saved.id);
  assertEquals(got?.name, "Weekly");

  const list = await listEmailReportConfigs(ORG);
  assert(list.some((c) => c.id === saved.id));

  await deleteEmailReportConfig(ORG, saved.id);
  assertEquals(await getEmailReportConfig(ORG, saved.id), null);
}});

Deno.test({ name: "email template — save, get, list, delete", ...kvOpts, fn: async () => {
  const saved = await saveEmailTemplate(ORG, { name: "Alert", subject: "Alert!", html: "<h1>Hi</h1>" });
  assert(saved.id);

  const got = await getEmailTemplate(ORG, saved.id);
  assertEquals(got?.subject, "Alert!");

  const list = await listEmailTemplates(ORG);
  assert(list.some((t) => t.id === saved.id));

  await deleteEmailTemplate(ORG, saved.id);
  assertEquals(await getEmailTemplate(ORG, saved.id), null);
}});

Deno.test({ name: "email preview — save, get, delete", ...kvOpts, fn: async () => {
  await saveEmailReportPreview(ORG, "cfg-1", "<html>preview</html>");
  const preview = await getEmailReportPreview(ORG, "cfg-1");
  assertEquals(preview?.html, "<html>preview</html>");
  assert(preview!.renderedAt > 0);

  await deleteEmailReportPreview(ORG, "cfg-1");
  assertEquals(await getEmailReportPreview(ORG, "cfg-1"), null);
}});

Deno.test({ name: "report last fired — set and get", ...kvOpts, fn: async () => {
  assertEquals(await getReportLastFired(ORG, "r-1"), 0); // default
  await setReportLastFired(ORG, "r-1", 12345);
  assertEquals(await getReportLastFired(ORG, "r-1"), 12345);
}});
