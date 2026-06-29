/** E2E for the weekly-builder controller. The publish path persists real
 *  EmailReportConfig records via the existing email repository so we can
 *  verify them by listing afterwards.
 *
 *  Contract note: the client (staging editor) builds the full, possibly
 *  customized EmailReportConfig and sends it as `staged.config`. The server
 *  persists it as-is, only falling back to manager-scope / office recipients
 *  when the client left recipients empty. These tests guard that merge plus
 *  the "reports actually fire" invariant: every published config must come out
 *  with enabled === true AND a real schedule.cron. */
import { assert, assertEquals } from "#assert";
import { WeeklyBuilderController } from "./mod.ts";
import { listEmailReportConfigs } from "@reporting/domain/data/email-repository/mod.ts";
import { saveAuditDimensions, saveManagerScope, updatePartnerDimensions } from "@admin/domain/data/admin-repository/mod.ts";
import { createUser } from "@core/business/auth/mod.ts";
import { resetFirestoreCredentials } from "@core/data/firestore/mod.ts";

Deno.env.set("LOCAL_QUEUE", "true");

const COLUMNS = ["finalizedAt", "voName", "department", "score", "recordId", "findingId"];

/** Mirror of the client-side buildStagedConfig for an internal department. */
function internalStaged(department: string, shift: string | null, name: string, recipients: string[] = []) {
  return {
    type: "internal" as const,
    department,
    shift,
    config: {
      name,
      recipients,
      reportSections: [{ header: name, columns: COLUMNS, criteria: [] }],
      dateRange: { mode: "weekly", startDay: 1 },
      onlyCompleted: true,
      enabled: true,
      failedOnly: false,
      schedule: { cron: "0 21 * * *", tz: "America/New_York" },
      weeklyType: "internal",
      weeklyDepartment: department,
      weeklyShift: shift ?? undefined,
      topLevelFilters: [
        { field: "auditType", operator: "equals", value: "internal" },
        { field: "department", operator: "equals", value: department },
        ...(shift ? [{ field: "shift", operator: "equals", value: shift }] : []),
        { field: "appealStatus", operator: "not_equals", value: "pending" },
      ],
    },
  };
}

function partnerStaged(office: string, name: string, recipients: string[] = []) {
  return {
    type: "partner" as const,
    office,
    config: {
      name,
      recipients,
      reportSections: [{ header: name, columns: COLUMNS, criteria: [] }],
      dateRange: { mode: "weekly", startDay: 1 },
      onlyCompleted: true,
      enabled: true,
      failedOnly: false,
      schedule: { cron: "0 21 * * *", tz: "America/New_York" },
      weeklyType: "partner",
      weeklyOffice: office,
      topLevelFilters: [
        { field: "auditType", operator: "equals", value: "partner" },
        { field: "department", operator: "equals", value: office },
        { field: "appealStatus", operator: "not_equals", value: "pending" },
      ],
    },
  };
}

// deno-lint-ignore no-explicit-any
function publishBody(staged: unknown[]): any {
  return { configs: staged };
}

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
  assert("deptShifts" in data, "getData must include department→shift coverage");
  assertEquals(data.auditDims.departments.includes("DEPT-A"), true);
  assertEquals(data.managerScopes["alice@example.com"]?.departments, ["DEPT-A"]);
  assert(Array.isArray(data.partnerDims.offices?.["OFFICE-X"]));
}});

Deno.test({ name: "WeeklyBuilder.publish — empty client recipients fall back to manager-scope; config is enabled with a real cron", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const ORG = "wb-pub-" + crypto.randomUUID().slice(0, 8);
  Deno.env.set("DEFAULT_ORG_ID", ORG);

  await saveAuditDimensions(ORG as any, { departments: ["BETA"], shifts: ["AM"] });
  await saveManagerScope(ORG as any, "manager-a@example.com", { departments: ["BETA"], shifts: ["AM"] });
  await saveManagerScope(ORG as any, "manager-b@example.com", { departments: ["BETA"], shifts: ["PM"] });

  const controller = new WeeklyBuilderController();
  // recipients left empty → server fills from manager scope
  const result = await controller.publish(publishBody([internalStaged("BETA", "AM", "BETA AM Weekly", [])])) as any;
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
  // Regression guard for the "reports never fire" bug: the tick requires BOTH.
  assertEquals((cfg as any).enabled, true);
  assertEquals(cfg!.schedule?.cron, "0 21 * * *");
  assertEquals(cfg!.schedule?.tz, "America/New_York");
  assert(Array.isArray(cfg!.topLevelFilters), "topLevelFilters must persist");
  assert(cfg!.topLevelFilters!.some((f) => f.field === "auditType" && f.value === "internal"));
  assert(cfg!.topLevelFilters!.some((f) => f.field === "department" && f.value === "BETA"));
}});

Deno.test({ name: "WeeklyBuilder.publish — explicit client recipients are preserved (incl. addresses outside the org)", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const ORG = "wb-recip-" + crypto.randomUUID().slice(0, 8);
  Deno.env.set("DEFAULT_ORG_ID", ORG);

  await saveManagerScope(ORG as any, "scope-mgr@example.com", { departments: ["GAMMA"], shifts: [] });

  const controller = new WeeklyBuilderController();
  const edited = ["someone@monsterrg.com", "external@gmail.com"];
  await controller.publish(publishBody([internalStaged("GAMMA", null, "GAMMA Weekly", edited)]));

  const list = await listEmailReportConfigs(ORG as any);
  const cfg = list.find((c) => c.name === "GAMMA Weekly");
  // Client-supplied recipients win; the manager-scope fallback is NOT applied.
  assertEquals(cfg!.recipients?.sort(), edited.sort());
}});

Deno.test({ name: "WeeklyBuilder.publish — partner config falls back to partner-dimensions recipients", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const ORG = "wb-pub-pkg-" + crypto.randomUUID().slice(0, 8);
  Deno.env.set("DEFAULT_ORG_ID", ORG);

  await updatePartnerDimensions(ORG as any, "EAST", "east-gm@example.com");
  await updatePartnerDimensions(ORG as any, "EAST", "east-asst@example.com");

  const controller = new WeeklyBuilderController();
  const result = await controller.publish(publishBody([partnerStaged("EAST", "EAST Weekly", [])])) as any;
  assertEquals(result.created, 1);

  const list = await listEmailReportConfigs(ORG as any);
  const cfg = list.find((c) => c.name === "EAST Weekly");
  assertEquals(cfg!.recipients?.sort(), ["east-asst@example.com", "east-gm@example.com"]);
  assertEquals((cfg as any).weeklyOffice, "EAST");
  assertEquals((cfg as any).enabled, true);
  assertEquals(cfg!.schedule?.cron, "0 21 * * *");
}});

Deno.test({ name: "WeeklyBuilder.publish — duplicate staged config is skipped on second publish", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const ORG = "wb-dup-" + crypto.randomUUID().slice(0, 8);
  Deno.env.set("DEFAULT_ORG_ID", ORG);

  await saveManagerScope(ORG as any, "x@example.com", { departments: ["X"], shifts: [] });
  const controller = new WeeklyBuilderController();
  const staged = internalStaged("X", null, "X Weekly", []);

  const r1 = await controller.publish(publishBody([staged])) as any;
  assertEquals(r1.created, 1);

  const r2 = await controller.publish(publishBody([staged])) as any;
  assertEquals(r2.created, 0);
  assertEquals(r2.skipped, ["X Weekly"]);
}});

Deno.test({ name: "WeeklyBuilder — super-managers (president role) are excluded from scopes + auto-recipients", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const ORG = "wb-super-" + crypto.randomUUID().slice(0, 8);
  Deno.env.set("DEFAULT_ORG_ID", ORG);

  // boss is a super-manager whose scope spans every department; mgr is normal.
  await saveManagerScope(ORG as any, "boss@example.com", { departments: ["A", "B", "C"], shifts: [] });
  await saveManagerScope(ORG as any, "mgr@example.com", { departments: ["A"], shifts: [] });
  await createUser(ORG as any, "boss@example.com", "pw", "super-manager");
  await createUser(ORG as any, "mgr@example.com", "pw", "manager");

  const ctrl = new WeeklyBuilderController();
  const data = await ctrl.getData() as any;
  assert(!("boss@example.com" in data.managerScopes), "super-manager must be excluded from scopes");
  assert("mgr@example.com" in data.managerScopes, "normal manager stays");

  // Publishing a dept-A report with empty recipients falls back to scope — and
  // that fallback must also exclude the super-manager.
  await ctrl.publish(publishBody([internalStaged("A", null, "A Weekly", [])]));
  const cfg = (await listEmailReportConfigs(ORG as any)).find((c) => c.name === "A Weekly");
  assertEquals(cfg!.recipients, ["mgr@example.com"]);
}});

Deno.test({ name: "WeeklyBuilder.publish — staggers send times 10 min apart", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const ORG = "wb-stagger-" + crypto.randomUUID().slice(0, 8);
  Deno.env.set("DEFAULT_ORG_ID", ORG);
  await saveManagerScope(ORG as any, "m@x.com", { departments: ["A", "B", "C"], shifts: [] });
  await new WeeklyBuilderController().publish(publishBody([
    internalStaged("A", null, "A Weekly", ["m@x.com"]),
    internalStaged("B", null, "B Weekly", ["m@x.com"]),
    internalStaged("C", null, "C Weekly", ["m@x.com"]),
  ]));
  const list = await listEmailReportConfigs(ORG as any);
  assertEquals(list.find((c) => c.name === "A Weekly")!.schedule?.cron, "0 21 * * *");
  assertEquals(list.find((c) => c.name === "B Weekly")!.schedule?.cron, "10 21 * * *");
  assertEquals(list.find((c) => c.name === "C Weekly")!.schedule?.cron, "20 21 * * *");
}});

Deno.test({ name: "WeeklyBuilder.publish — a custom (edited) send time is kept, not staggered", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const ORG = "wb-custom-" + crypto.randomUUID().slice(0, 8);
  Deno.env.set("DEFAULT_ORG_ID", ORG);
  await saveManagerScope(ORG as any, "m@x.com", { departments: ["A"], shifts: [] });
  const staged = internalStaged("A", null, "A Weekly", ["m@x.com"]);
  (staged.config as any).schedule = { cron: "30 20 * * *", tz: "America/New_York" }; // edited → 8:30 PM
  await new WeeklyBuilderController().publish(publishBody([staged]));
  const cfg = (await listEmailReportConfigs(ORG as any)).find((c) => c.name === "A Weekly");
  assertEquals(cfg!.schedule?.cron, "30 20 * * *", "custom send time preserved, not staggered");
}});

Deno.test({ name: "WeeklyBuilder.publish — empty configs returns error", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const controller = new WeeklyBuilderController();
  const r = await controller.publish(publishBody([])) as any;
  assertEquals(r.error, "no configs");
}});
