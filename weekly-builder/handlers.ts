import { resolveEffectiveAuth } from "../auth/kv.ts";
import {
  getPartnerDimensions,
  listManagerScopes,
  listEmailReportConfigs,
  saveEmailReportConfig,
  getOfficeBypassConfig,
} from "../lib/kv.ts";
import type { EmailReportConfig } from "../lib/kv.ts";
import { runReport } from "../lib/report-engine.ts";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface StagedConfig {
  type: "internal" | "partner";
  department?: string;
  office?: string;
  shift?: string | null;
  name: string;
}

function buildTopLevelFilters(staged: StagedConfig) {
  const filters: { field: string; operator: string; value: string }[] = [];
  if (staged.type === "internal") {
    filters.push({ field: "auditType", operator: "equals", value: "internal" });
    if (staged.department) filters.push({ field: "department", operator: "equals", value: staged.department });
    if (staged.shift) filters.push({ field: "shift", operator: "equals", value: staged.shift });
  } else {
    filters.push({ field: "auditType", operator: "equals", value: "partner" });
    if (staged.office) filters.push({ field: "department", operator: "equals", value: staged.office });
  }
  filters.push({ field: "appealStatus", operator: "not_equals", value: "pending" });
  return filters;
}

function buildEphemeralConfig(staged: StagedConfig, recipients: string[]): EmailReportConfig {
  return {
    id: crypto.randomUUID(),
    name: staged.name,
    weeklyType: staged.type,
    weeklyDepartment: staged.department,
    weeklyShift: staged.shift ?? undefined,
    weeklyOffice: staged.office,
    dateRange: { mode: "weekly", startDay: 1 },
    onlyCompleted: true,
    schedule: { mode: "cron", expression: "0 1 * * *" },
    topLevelFilters: buildTopLevelFilters(staged),
    reportSections: [{
      header: staged.name,
      columns: ["finalizedAt", "voName", "department", "score", "recordId", "findingId"],
      criteria: [],
    }],
    recipients,
    disabled: false,
  } as unknown as EmailReportConfig;
}

function isDuplicate(staged: StagedConfig, existing: EmailReportConfig[]): boolean {
  return existing.some((c) => {
    if (!c.weeklyType) return false;
    if (staged.type === "internal") {
      return c.weeklyType === "internal" &&
        c.weeklyDepartment === staged.department &&
        (c.weeklyShift ?? null) === (staged.shift ?? null);
    }
    return c.weeklyType === "partner" && c.weeklyOffice === staged.office;
  });
}

export async function handleWeeklyBuilderTestSend(req: Request): Promise<Response> {
  const auth = await resolveEffectiveAuth(req);
  if (!auth || auth.role !== "admin") return json({ error: "forbidden" }, 403);

  const body = await req.json();
  const { testEmail, configs } = body as { testEmail: string; configs: StagedConfig[] };
  if (!testEmail) return json({ error: "testEmail required" }, 400);
  if (!configs?.length) return json({ error: "no configs" }, 400);

  const results = await Promise.allSettled(
    configs.map((staged) => {
      const ephemeral = buildEphemeralConfig(staged, [testEmail]);
      const timeout = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("timeout after 55s")), 55_000)
      );
      return Promise.race([runReport(auth.orgId, ephemeral), timeout]);
    })
  );

  const sent = results.filter((r) => r.status === "fulfilled").length;
  const errors = results
    .map((r, i) => r.status === "rejected" ? `${configs[i].name}: ${(r as PromiseRejectedResult).reason?.message ?? r.reason}` : null)
    .filter(Boolean) as string[];

  return json({ sent, errors });
}

export async function handleWeeklyBuilderPublish(req: Request): Promise<Response> {
  const auth = await resolveEffectiveAuth(req);
  if (!auth || auth.role !== "admin") return json({ error: "forbidden" }, 403);

  const body = await req.json();
  const { configs } = body as { configs: StagedConfig[] };
  if (!configs?.length) return json({ error: "no configs" }, 400);

  const [partnerDims, managerScopes, existingConfigs] = await Promise.all([
    getPartnerDimensions(auth.orgId),
    listManagerScopes(auth.orgId),
    listEmailReportConfigs(auth.orgId),
  ]);

  // Invert manager scopes: dept -> emails
  const deptEmails: Record<string, string[]> = {};
  for (const [email, scope] of Object.entries(managerScopes)) {
    for (const dept of (scope.departments ?? [])) {
      if (!deptEmails[dept]) deptEmails[dept] = [];
      if (!deptEmails[dept].includes(email)) deptEmails[dept].push(email);
    }
  }

  const hUtc = (20 + 5) % 24;
  let created = 0;
  const skipped: string[] = [];

  for (const staged of configs) {
    if (isDuplicate(staged, existingConfigs)) {
      skipped.push(staged.name);
      continue;
    }

    const recipients = staged.type === "internal"
      ? (deptEmails[staged.department ?? ""] ?? [])
      : ((partnerDims.offices ?? {})[staged.office ?? ""] ?? []);

    await saveEmailReportConfig(auth.orgId, {
      name: staged.name,
      weeklyType: staged.type,
      weeklyDepartment: staged.department,
      weeklyShift: staged.shift ?? undefined,
      weeklyOffice: staged.office,
      weeklyAutoRecipients: [],
      dateRange: { mode: "weekly", startDay: 1 },
      onlyCompleted: true,
      schedule: { mode: "cron", expression: `0 ${hUtc} * * *` },
      topLevelFilters: buildTopLevelFilters(staged),
      reportSections: [{
        header: staged.name,
        columns: ["finalizedAt", "voName", "department", "score", "recordId", "findingId"],
        criteria: [],
      }],
      recipients,
      disabled: true,
    } as any);

    created++;
  }

  return json({ created, skipped });
}

export async function handleWeeklyBuilderGetData(req: Request): Promise<Response> {
  const auth = await resolveEffectiveAuth(req);
  if (!auth || auth.role !== "admin") return json({ error: "forbidden" }, 403);

  const [partnerDims, managerScopes, bypassCfg, existingConfigs] = await Promise.all([
    getPartnerDimensions(auth.orgId),
    listManagerScopes(auth.orgId),
    getOfficeBypassConfig(auth.orgId),
    listEmailReportConfigs(auth.orgId),
  ]);

  return json({ partnerDims, managerScopes, bypassCfg, existingConfigs });
}
