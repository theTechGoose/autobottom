/** Smoke tests for admin config repository. */

import { assertEquals, assert } from "jsr:@std/assert";
import {
  getPipelineConfig, setPipelineConfig,
  getWebhookConfig, saveWebhookConfig,
  getBadWordConfig, saveBadWordConfig,
  getOfficeBypassConfig, saveOfficeBypassConfig,
  getBonusPointsConfig, saveBonusPointsConfig,
  getManagerScope, saveManagerScope, listManagerScopes,
  getAuditDimensions, saveAuditDimensions, updateAuditDimensions,
  getPartnerDimensions, updatePartnerDimensions,
  getReviewerConfig, saveReviewerConfig,
} from "./mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };
const ORG = "test-org-" + crypto.randomUUID().slice(0, 8) + Date.now();

Deno.test({ name: "pipeline config — defaults then override", ...kvOpts, fn: async () => {
  const defaults = await getPipelineConfig(ORG);
  assertEquals(defaults.maxRetries, 5);
  const updated = await setPipelineConfig(ORG, { maxRetries: 10 });
  assertEquals(updated.maxRetries, 10);
  assertEquals(updated.parallelism, 20); // preserved
}});

Deno.test({ name: "webhook config — save and get", ...kvOpts, fn: async () => {
  await saveWebhookConfig(ORG, "terminate", { postUrl: "https://example.com/hook", postHeaders: {} });
  const got = await getWebhookConfig(ORG, "terminate");
  assertEquals(got?.postUrl, "https://example.com/hook");
}});

Deno.test({ name: "webhook config — missing returns null", ...kvOpts, fn: async () => {
  assertEquals(await getWebhookConfig(ORG, "appeal"), null);
}});

Deno.test({ name: "bad word config — defaults", ...kvOpts, fn: async () => {
  const cfg = await getBadWordConfig(ORG);
  assertEquals(cfg.enabled, false);
}});

Deno.test({ name: "bad word config — save and get", ...kvOpts, fn: async () => {
  await saveBadWordConfig(ORG, { enabled: true, emails: ["a@b.com"], words: [], allOffices: false, officePatterns: [] });
  const cfg = await getBadWordConfig(ORG);
  assertEquals(cfg.enabled, true);
}});

Deno.test({ name: "bypass config — defaults to empty", ...kvOpts, fn: async () => {
  assertEquals((await getOfficeBypassConfig(ORG)).patterns.length, 0);
}});

Deno.test({ name: "bypass config — save and get", ...kvOpts, fn: async () => {
  await saveOfficeBypassConfig(ORG, { patterns: ["jay", "gun"] });
  assertEquals((await getOfficeBypassConfig(ORG)).patterns.length, 2);
}});

Deno.test({ name: "bonus config — defaults to zero", ...kvOpts, fn: async () => {
  const cfg = await getBonusPointsConfig(ORG);
  assertEquals(cfg.internalBonusPoints, 0);
}});

Deno.test({ name: "manager scopes — save, get, list", ...kvOpts, fn: async () => {
  await saveManagerScope(ORG, "mgr@test.com", { departments: ["Sales"], shifts: ["AM"] });
  const scope = await getManagerScope(ORG, "mgr@test.com");
  assertEquals(scope.departments, ["Sales"]);
  const all = await listManagerScopes(ORG);
  assert("mgr@test.com" in all);
}});

Deno.test({ name: "audit dimensions — update accumulates", ...kvOpts, fn: async () => {
  await updateAuditDimensions(ORG, "Sales");
  await updateAuditDimensions(ORG, "Support");
  await updateAuditDimensions(ORG, "Sales"); // duplicate
  const dims = await getAuditDimensions(ORG);
  assertEquals(dims.departments.length, 2);
}});

Deno.test({ name: "partner dimensions — update accumulates", ...kvOpts, fn: async () => {
  await updatePartnerDimensions(ORG, "East", "gm@east.com");
  await updatePartnerDimensions(ORG, "East", "gm2@east.com");
  const dims = await getPartnerDimensions(ORG);
  assertEquals(dims.offices["East"].length, 2);
}});

Deno.test({ name: "reviewer config — save and get", ...kvOpts, fn: async () => {
  await saveReviewerConfig(ORG, "rev@test.com", { allowedTypes: ["date-leg"] });
  const cfg = await getReviewerConfig(ORG, "rev@test.com");
  assertEquals(cfg?.allowedTypes, ["date-leg"]);
}});
