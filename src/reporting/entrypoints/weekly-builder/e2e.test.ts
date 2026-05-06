/** E2E for the weekly-builder controller. The publish path persists real
 *  EmailReportConfig records via the existing email repository so we can
 *  verify them by listing afterwards. */
import { assert, assertEquals } from "#assert";
import { WeeklyBuilderController } from "./mod.ts";
import { listEmailReportConfigs } from "@reporting/domain/data/email-repository/mod.ts";
import { saveAuditDimensions, saveManagerScope, updatePartnerDimensions } from "@admin/domain/data/admin-repository/mod.ts";
import { resetFirestoreCredentials } from "@core/data/firestore/mod.ts";

Deno.env.set("LOCAL_QUEUE", "true");

Deno.test({ name: "WeeklyBuilder.getData — returns shape with partnerDims, managerScopes, bypassCfg, existingConfigs, auditDims", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const ORG = "wb-data-" + crypto.randomUUID().slice(0, 8);
  Deno.env.set("DEFAULT_ORG_ID", ORG);

  await saveAuditDimensions(ORG as any, { departments: ["DEPT-A", "DEPT-B"], shifts: ["AM", "PM"] });
  await saveManagerScope(ORG as any, "alice@example.com", { departments: ["DEPT-A"], shifts: ["AM"] });
  await updatePartnerDimensions(ORG as any, "OFFICE-X", "gm@example.com");

  const controller = new WeeklyBuilderController();
  const data = await controller.getData() as any;
  assert(typeof data === "object");
  assert("partnerDims" in data);
  assert("managerScopes" in data);
  assert("bypassCfg" in data);
  assert("existingConfigs" in data);
  assert("auditDims" in data);
  assertEquals(data.auditDims.departments.includes("DEPT-A"), true);
  assertEquals(data.managerScopes["alice@example.com"]?.departments, ["DEPT-A"]);
  assert(Array.isArray(data.partnerDims.offices?.["OFFICE-X"]));
}});

Deno.test({ name: "WeeklyBuilder.publish — internal staged config creates EmailReportConfig with manager-scope-derived recipients", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const ORG = "wb-pub-" + crypto.randomUUID().slice(0, 8);
  Deno.env.set("DEFAULT_ORG_ID", ORG);

  await saveAuditDimensions(ORG as any, { departments: ["BETA"], shifts: ["AM"] });
  await saveManagerScope(ORG as any, "manager-a@example.com", { departments: ["BETA"], shifts: ["AM"] });
  await saveManagerScope(ORG as any, "manager-b@example.com", { departments: ["BETA"], shifts: ["PM"] });

  const controller = new WeeklyBuilderController();
  const result = await controller.publish({
    configs: [{ type: "internal", department: "BETA", shift: "AM", name: "BETA AM Weekly" }],
  } as unknown as Parameters<typeof controller.publish>[0]) as any;
  assertEquals(result.ok, true);
  assertEquals(result.created, 1);
  assertEquals(result.skipped, []);

  const list = await listEmailReportConfigs(ORG as any);
  const cfg = list.find((c) => c.name === "BETA AM Weekly");
  assert(!!cfg, "publish must persist the config");
  assertEquals(cfg!.recipients?.sort(), ["manager-a@example.com", "manager-b@example.com"]);
  assertEquals(cfg!.weeklyType, "internal");
  assertEquals((cfg as any).weeklyDepartment, "BETA");
  assertEquals((cfg as any).weeklyShift, "AM");
  assert(Array.isArray(cfg!.topLevelFilters), "topLevelFilters must persist");
  assert(cfg!.topLevelFilters!.some((f) => f.field === "auditType" && f.value === "internal"));
  assert(cfg!.topLevelFilters!.some((f) => f.field === "department" && f.value === "BETA"));
}});

Deno.test({ name: "WeeklyBuilder.publish — partner staged config uses partner-dimensions recipients", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const ORG = "wb-pub-pkg-" + crypto.randomUUID().slice(0, 8);
  Deno.env.set("DEFAULT_ORG_ID", ORG);

  await updatePartnerDimensions(ORG as any, "EAST", "east-gm@example.com");
  await updatePartnerDimensions(ORG as any, "EAST", "east-asst@example.com");

  const controller = new WeeklyBuilderController();
  const result = await controller.publish({
    configs: [{ type: "partner", office: "EAST", name: "EAST Weekly" }],
  } as unknown as Parameters<typeof controller.publish>[0]) as any;
  assertEquals(result.created, 1);

  const list = await listEmailReportConfigs(ORG as any);
  const cfg = list.find((c) => c.name === "EAST Weekly");
  assertEquals(cfg!.recipients?.sort(), ["east-asst@example.com", "east-gm@example.com"]);
  assertEquals((cfg as any).weeklyOffice, "EAST");
}});

Deno.test({ name: "WeeklyBuilder.publish — duplicate staged config is skipped on second publish", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const ORG = "wb-dup-" + crypto.randomUUID().slice(0, 8);
  Deno.env.set("DEFAULT_ORG_ID", ORG);

  await saveManagerScope(ORG as any, "x@example.com", { departments: ["X"], shifts: [] });
  const controller = new WeeklyBuilderController();
  const staged = { type: "internal" as const, department: "X", shift: null, name: "X Weekly" };

  const r1 = await controller.publish({ configs: [staged] } as unknown as Parameters<typeof controller.publish>[0]) as any;
  assertEquals(r1.created, 1);

  const r2 = await controller.publish({ configs: [staged] } as unknown as Parameters<typeof controller.publish>[0]) as any;
  assertEquals(r2.created, 0);
  assertEquals(r2.skipped, ["X Weekly"]);
}});

Deno.test({ name: "WeeklyBuilder.publish — empty configs returns error", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const controller = new WeeklyBuilderController();
  const r = await controller.publish({ configs: [] } as unknown as Parameters<typeof controller.publish>[0]) as any;
  assertEquals(r.error, "no configs");
}});
