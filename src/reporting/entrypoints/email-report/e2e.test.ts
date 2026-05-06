/** E2E for the email-report controller. Verifies the full schema round-trips
 *  through saveEmailReportConfig + the new previewInline endpoint renders. */
import { assert, assertEquals } from "#assert";
import { EmailReportController } from "./mod.ts";
import { listEmailReportConfigs, getEmailReportConfig } from "@reporting/domain/data/email-repository/mod.ts";
import { resetFirestoreCredentials } from "@core/data/firestore/mod.ts";

Deno.env.set("LOCAL_QUEUE", "true");

Deno.test({ name: "EmailReports.save — full schema round-trips (sections + filters + dateRange + cc/bcc)", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const ORG = "er-save-" + crypto.randomUUID().slice(0, 8);
  Deno.env.set("DEFAULT_ORG_ID", ORG);

  const controller = new EmailReportController();
  const r = await controller.save({
    name: "Full Schema Test",
    recipients: ["a@x.com"],
    cc: ["c@x.com"],
    bcc: ["b@x.com"],
    templateId: "tpl-1",
    onlyCompleted: false,
    failedOnly: true,
    weeklyType: "internal",
    schedule: { cron: "0 8 * * 1" },
    enabled: true,
    dateRange: { mode: "rolling", hours: 168 },
    topLevelFilters: [
      { field: "score", operator: "less_than", value: "80" },
    ],
    reportSections: [
      { header: "Failed", columns: ["recordId", "score", "voName"], criteria: [
        { field: "score", operator: "less_than", value: "100" },
      ]},
      { header: "Reviewed", columns: ["findingId", "appealStatus"], criteria: [
        { field: "reviewed", operator: "equals", value: "true" },
      ]},
    ],
  } as unknown as Parameters<typeof controller.save>[0]) as any;
  assertEquals(r.ok, true);
  assert(r.config?.id);

  const back = await getEmailReportConfig(ORG as any, r.config.id);
  assert(!!back);
  assertEquals(back!.cc, ["c@x.com"]);
  assertEquals(back!.bcc, ["b@x.com"]);
  assertEquals(back!.templateId, "tpl-1");
  assertEquals(back!.failedOnly, true);
  assertEquals(back!.weeklyType, "internal");
  assertEquals(back!.schedule?.cron, "0 8 * * 1");
  assertEquals(back!.enabled, true);
  assertEquals(back!.dateRange, { mode: "rolling", hours: 168 });
  assertEquals(back!.topLevelFilters?.length, 1);
  assertEquals(back!.reportSections.length, 2);
  assertEquals(back!.reportSections[0].columns, ["recordId", "score", "voName"]);
}});

Deno.test({ name: "EmailReports.previewInline — returns rendered HTML containing each section header", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const ORG = "er-prev-" + crypto.randomUUID().slice(0, 8);
  Deno.env.set("DEFAULT_ORG_ID", ORG);

  const controller = new EmailReportController();
  const r = await controller.previewInline({
    name: "Inline Preview",
    recipients: [],
    reportSections: [
      { header: "Section Alpha", columns: ["recordId", "score"], criteria: [] },
      { header: "Section Beta", columns: ["findingId"], criteria: [] },
    ],
    onlyCompleted: false,
  } as unknown as Parameters<typeof controller.previewInline>[0]) as any;

  assert(typeof r.html === "string");
  assert(r.html.includes("Section Alpha"));
  assert(r.html.includes("Section Beta"));
  assert(r.html.includes("Inline Preview"));
}});

Deno.test({ name: "EmailReports.previewInline — returns html with empty body when no sections supplied", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const ORG = "er-prev-empty-" + crypto.randomUUID().slice(0, 8);
  Deno.env.set("DEFAULT_ORG_ID", ORG);

  const controller = new EmailReportController();
  const r = await controller.previewInline({
    name: "Empty",
    recipients: [],
    reportSections: [],
  } as unknown as Parameters<typeof controller.previewInline>[0]) as any;
  assert(typeof r.html === "string");
  assertEquals(r.html.includes("Empty"), true, "should still render the title shell");
}});

Deno.test({ name: "EmailReports.list — newly saved config shows up", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const ORG = "er-list-" + crypto.randomUUID().slice(0, 8);
  Deno.env.set("DEFAULT_ORG_ID", ORG);

  const controller = new EmailReportController();
  await controller.save({
    name: "List Test",
    recipients: ["x@y.com"],
    reportSections: [],
  } as unknown as Parameters<typeof controller.save>[0]);

  const r = await controller.list();
  const list = (r as { configs: { name: string }[] }).configs;
  assert(list.some((c) => c.name === "List Test"));

  // Sanity: same data lives in the repo
  const fromRepo = await listEmailReportConfigs(ORG as any);
  assert(fromRepo.some((c) => c.name === "List Test"));
}});
