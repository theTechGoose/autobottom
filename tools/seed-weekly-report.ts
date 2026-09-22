/** Capture a real weekly report from prod, then replay it into the Firestore
 *  emulator so the whole thing can be rendered and poked at locally.
 *
 *    export:  deno run -A --no-check --config deno.json --env-file=autobottom.env \
 *               tools/seed-weekly-report.ts export "VO Team / IDS Audits"
 *             (needs FIREBASE_SA_S3_KEY, FIREBASE_PROJECT_ID, DEFAULT_ORG_ID)
 *
 *    demo:    same flags as seed — adds the two "Other" rules on top of a seed:
 *             excludes Online App Rebook from reporting, and injects one
 *             synthetic "GS MB - Other" audit that is NOT Rebook, so the
 *             bottom-of-report card has something to show.
 *
 *    seed:    deno run -A --no-check --config deno.json \
 *               --env-file=autobottom.env --env-file=emulator.env \
 *               tools/seed-weekly-report.ts seed
 *
 *  The fixture holds every audit the report actually contained — index row,
 *  the finding fields the engine hydrates, and the failed-question rows behind
 *  the category counts — plus the report config itself, pinned to a FIXED date
 *  range so it renders the same on any day you run it.
 *
 *  Seeding REFUSES to run unless EMULATOR=true. Without that flag this app
 *  reads and writes prod, and a seeder pointed at prod would forge audits. */

import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { queryReportData, resolveDateRange } from "@reporting/domain/business/email-report-engine/mod.ts";
import { queryAuditDoneIndex, writeAuditDoneIndex } from "@audit/domain/data/stats-repository/mod.ts";
import { getFinding, saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { writeFailedFindingRows } from "@audit/domain/data/failed-finding-repository/mod.ts";
import { listEmailReportConfigs, saveEmailReportConfig, saveWeeklyReportView } from "@reporting/domain/data/email-repository/mod.ts";
import { buildWeeklyRender, weeklyReportSlug } from "@reporting/domain/business/email-report-engine/mod.ts";
import { saveOfficeBypassConfig } from "@admin/domain/data/admin-repository/mod.ts";

const FIXTURE = "fixtures/json/weekly-report-seed.json";
/** Long free text (reasoning, transcript quotes) is cut to this — the report
 *  only needs the header, the answer and a short defense. */
const TEXT_CAP = 400;
/** Prod wedges under concurrent reads — keep the crawl small and paced. */
const READ_BATCH = 10;
const READ_PAUSE_MS = 120;

/** Only the record fields the report engine and digest actually read. */
const RECORD_FIELDS = [
  "VoName", "ActivatingOffice", "OfficeName", "Shift", "RecordId",
  "SupervisorEmail", "GuestName", "RelatedEmployeeId",
];

interface Fixture {
  capturedAt: string;
  sourceOrg: string;
  window: { from: number; to: number };
  config: Record<string, unknown>;
  index: Record<string, unknown>[];
  findings: Record<string, unknown>[];
}

/** Shrink one answered question: keep every field (the failure-source and
 *  pass/fail helpers read several), just cap the long prose. */
function trimQuestion(q: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(q ?? {})) {
    out[k] = typeof v === "string" && v.length > TEXT_CAP ? v.slice(0, TEXT_CAP) : v;
  }
  return out;
}

function orgId(): OrgId {
  const org = Deno.env.get("DEFAULT_ORG_ID");
  if (!org) throw new Error("DEFAULT_ORG_ID is required");
  return org as OrgId;
}

async function exportReport(reportName: string): Promise<void> {
  const org = orgId();
  const configs = await listEmailReportConfigs(org);
  const config = (configs as Record<string, any>[]).find((c) => c.name === reportName);
  if (!config) throw new Error(`no report named ${JSON.stringify(reportName)}`);

  const { from, to } = resolveDateRange(config.dateRange as any);
  console.log(`window ${new Date(from).toISOString()} → ${new Date(to).toISOString()}`);

  // The report itself decides what is on it — reuse it rather than guessing.
  const sections = await queryReportData(org, config as any);
  const onReport = new Set<string>();
  for (const s of sections) {
    for (const r of s.rows) if (r.findingId) onReport.add(r.findingId);
    console.log(`  section ${JSON.stringify(s.header)}: ${s.rows.length} rows`);
  }
  console.log(`${onReport.size} distinct audits on the report`);

  const index = (await queryAuditDoneIndex(org, from, to))
    .filter((e) => onReport.has(e.findingId));

  const findings: Record<string, unknown>[] = [];
  const ids = [...onReport];
  for (let i = 0; i < ids.length; i += READ_BATCH) {
    const batch = ids.slice(i, i + READ_BATCH);
    const docs = await Promise.all(batch.map((id) => getFinding(org, id)));
    for (const doc of docs as Record<string, any>[]) {
      if (!doc) continue;
      const record: Record<string, unknown> = {};
      for (const f of RECORD_FIELDS) {
        if (doc.record?.[f] !== undefined) record[f] = doc.record[f];
      }
      findings.push({
        id: doc.id,
        findingStatus: doc.findingStatus ?? "finished",
        recordingIdField: doc.recordingIdField,
        completedAt: doc.completedAt,
        score: doc.score,
        owner: doc.owner,
        recordingId: doc.recordingId,
        configId: doc.configId,
        // Kept so the seeder can rebuild the failed-question index with the
        // real writer, rather than hand-forging index rows that could drift
        // from what the app would actually have written.
        answeredQuestions: Array.isArray(doc.answeredQuestions)
          ? doc.answeredQuestions.map(trimQuestion)
          : undefined,
        record,
      });
    }
    console.log(`  findings ${Math.min(i + READ_BATCH, ids.length)}/${ids.length}`);
    await new Promise((r) => setTimeout(r, READ_PAUSE_MS));
  }

  const fixture: Fixture = {
    capturedAt: new Date().toISOString(),
    sourceOrg: String(org),
    window: { from, to },
    config: {
      ...config,
      // Pinned, so the seeded report renders the same window on any later day.
      dateRange: { mode: "fixed", from, to },
    },
    index: index as unknown as Record<string, unknown>[],
    findings,
  };

  await Deno.writeTextFile(FIXTURE, JSON.stringify(fixture, null, 2));
  console.log(`\nwrote ${FIXTURE}`);
  const graded = findings.filter((f) => Array.isArray((f as any).answeredQuestions)).length;
  console.log(`  ${fixture.index.length} index rows, ${findings.length} findings (${graded} with graded questions)`);
}

async function seed(): Promise<void> {
  if (Deno.env.get("EMULATOR") !== "true") {
    throw new Error(
      "refusing to seed: EMULATOR is not 'true'. Without it this writes PROD. " +
      "Run `deno task emulators`, then add --env-file=emulator.env.",
    );
  }
  const org = orgId();
  const fixture: Fixture = JSON.parse(await Deno.readTextFile(FIXTURE));
  console.log(`seeding org ${org} from a capture taken ${fixture.capturedAt}`);

  await saveEmailReportConfig(org, fixture.config as any);
  console.log(`  config ${JSON.stringify((fixture.config as any).name)}`);

  for (const doc of fixture.findings) await saveFinding(org, doc as any);
  console.log(`  ${fixture.findings.length} findings`);

  for (const entry of fixture.index) {
    await writeAuditDoneIndex(org, entry as any, { assumeFinished: true });
  }
  console.log(`  ${fixture.index.length} index rows`);

  // Rebuilt by the real writer from each finding's answers, so the category
  // counts on the seeded report are derived exactly as prod derives them.
  let failRows = 0;
  for (const doc of fixture.findings) failRows += await writeFailedFindingRows(org, doc as any);
  console.log(`  ${failRows} failed-question rows rebuilt from the findings`);

  // Render the full-report page the same way the send path does, so /r/<slug>
  // serves it locally without waiting for a cron to fire.
  const saved = await saveEmailReportConfig(org, fixture.config as any);
  const sections = await queryReportData(org, saved);
  const slug = await weeklyReportSlug(org, saved.id, fixture.window.from);
  const { pageHtml } = await buildWeeklyRender(org, saved, sections);
  await saveWeeklyReportView(slug, pageHtml);
  console.log(`\n  sections: ${sections.map((s) => `${s.header}=${s.rows.length}`).join("  ")}`);

  const other = fixture.findings.filter((f) => (f as any).record?.VoName === "GS MB - Other");
  console.log(`\nseeded. "GS MB - Other" audits present: ${other.length}`);
  for (const f of other) console.log(`  finding ${(f as any).id} record ${(f as any).record?.RecordId}`);
  console.log(`\nfull report: http://localhost:3000/r/${slug}   (deno task dev:emulator)`);
}

/** Re-render the seeded report's page and return the slug. */
async function rerender(org: OrgId, windowFrom: number): Promise<string> {
  const config = (await listEmailReportConfigs(org) as Record<string, any>[])
    .find((c) => c.name === "VO Team / IDS Audits");
  if (!config) throw new Error("seed first — no report config in the emulator");
  const sections = await queryReportData(org, config as any);
  const slug = await weeklyReportSlug(org, config.id, windowFrom);
  const { pageHtml } = await buildWeeklyRender(org, config as any, sections);
  await saveWeeklyReportView(slug, pageHtml);
  console.log(`  sections: ${sections.map((s) => `${s.header}=${s.rows.length}`).join("  ")}`);
  return slug;
}

/** Layer the two "Other" rules onto an already-seeded emulator. */
async function demo(): Promise<void> {
  if (Deno.env.get("EMULATOR") !== "true") throw new Error("refusing: EMULATOR is not 'true'");
  const org = orgId();
  const fixture: Fixture = JSON.parse(await Deno.readTextFile(FIXTURE));

  // Rule 1 — Online App Rebook never reaches a report.
  await saveOfficeBypassConfig(org, {
    patterns: [], departmentPatterns: [], reportExcludeDepartments: ["Online App Rebook"],
  } as any);
  console.log(`rule 1: excluded "Online App Rebook" from reporting (local only)`);

  // Rule 2 — a "- Other" audit that is NOT Rebook, so the bottom card has a
  // row. Modelled on the real one, moved onto a claimed department.
  const id = "demo-gsmb-other";
  const at = fixture.window.from + 6 * 3_600_000;
  await saveFinding(org, {
    id, findingStatus: "finished", completedAt: at, score: 60,
    recordingIdField: "GenieId",
    answeredQuestions: [
      { header: "Matching IDs", answer: "No", defense: "Synthetic demo row." },
      { header: "Guest Name", answer: "Yes", defense: "" },
    ],
    record: {
      VoName: "GS MB - Other", ActivatingOffice: "GS MB", Shift: "AM",
      RecordId: "999001", GuestName: "Demo Guest",
      SupervisorEmail: "haleys@monsterrg.com",
    },
  } as any);
  await writeAuditDoneIndex(org, {
    findingId: id, completedAt: at, doneAt: at, completed: true, reason: "reviewed",
    score: 60, recordId: "999001", voName: "Other", department: "GS MB",
    shift: "AM", isPackage: false,
  } as any, { assumeFinished: true });
  await writeFailedFindingRows(org, {
    id, completedAt: at, score: 60, recordingIdField: "GenieId",
    answeredQuestions: [{ header: "Matching IDs", answer: "No", defense: "Synthetic demo row." }],
    record: { VoName: "GS MB - Other", ActivatingOffice: "GS MB", Shift: "AM", RecordId: "999001" },
  } as any);
  console.log(`rule 2: injected ${id} — "GS MB - Other" on department "GS MB"`);

  const slug = await rerender(org, fixture.window.from);
  console.log(`\nfull report: http://localhost:3000/r/${slug}`);
}

const [mode, ...rest] = Deno.args;
if (mode === "export") await exportReport(rest.join(" ") || "VO Team / IDS Audits");
else if (mode === "seed") await seed();
else if (mode === "demo") await demo();
else {
  console.error("usage: seed-weekly-report.ts export [report name] | seed | demo");
  Deno.exit(1);
}
