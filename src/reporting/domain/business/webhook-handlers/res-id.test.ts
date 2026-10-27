/** Reservation ID in the webhook emails (REQ-031..033): which template a
 *  package vs date-leg audit uses, and the {{resId}} / {{resLink}} vars.
 *
 *  Fires the real handlers through fireWebhook against the Firestore emulator;
 *  Postmark is stubbed at fetch — only calls to postmarkUrl() are captured, and
 *  each test reads back only the mail sent to its own unique address. */
import { assert, assertEquals } from "#assert";
import { postmarkUrl } from "@core/config/endpoints.ts";
import { fireWebhook, saveWebhookConfig } from "@admin/domain/data/admin-repository/mod.ts";
import { saveEmailTemplate } from "@reporting/domain/data/email-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import type { WebhookConfig } from "@core/dto/types.ts";
import { registerAllWebhookEmailHandlers } from "./mod.ts";

registerAllWebhookEmailHandlers();

interface Mail { To: string; Subject: string; HtmlBody: string }
const outbox: Mail[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith(postmarkUrl())) return realFetch(input, init);
  outbox.push(JSON.parse(String(init?.body ?? "{}")));
  return Promise.resolve(Response.json({ ErrorCode: 0, Message: "OK", MessageID: crypto.randomUUID() }));
}) as typeof fetch;

const RES_URL = "https://monsterrg.quickbase.com/nav/app/bmhvhc7sk/table/bmhvhc72c/action/dr?rid=";

function org(): OrgId {
  return `res-id-${crypto.randomUUID().slice(0, 8)}` as OrgId;
}

function inbox(to: string): Mail[] {
  return outbox.filter((m) => m.To === to);
}

/** A finished audit. Date legs mail the VO, packages the GM. */
function finding(kind: "dateleg" | "package", record: Record<string, unknown>) {
  const to = `${kind}-${crypto.randomUUID().slice(0, 8)}@monsterrg.com`;
  return {
    to,
    finding: {
      id: `f-${crypto.randomUUID().slice(0, 8)}`,
      recordingIdField: kind === "package" ? "GenieNumber" : "VoGenie",
      owner: "api",
      answeredQuestions: [{ header: "Correct Dates", answer: "Yes" }],
      record: {
        RecordId: "434311",
        VoName: "DS MB - Demo Agent",
        ...(kind === "package" ? { GmEmail: to } : { VoEmail: to }),
        ...record,
      },
    },
  };
}

async function template(o: OrgId, subject: string, html = "<p>{{resLink}}</p>"): Promise<string> {
  return (await saveEmailTemplate(o, { name: subject, subject, html })).id;
}

async function config(o: OrgId, kind: "terminate" | "judge" | "appeal", cfg: Partial<WebhookConfig>) {
  await saveWebhookConfig(o, kind, { postUrl: "", postHeaders: {}, ...cfg } as WebhookConfig);
}

async function auditReport(o: OrgId, f: ReturnType<typeof finding>): Promise<Mail> {
  await fireWebhook(o, "terminate", { findingId: f.finding.id, finding: f.finding, reason: "perfect_score", score: 100 });
  const mail = inbox(f.to);
  assertEquals(mail.length, 1, `one audit-report email to ${f.to}`);
  return mail[0];
}

async function appealDecision(o: OrgId, f: ReturnType<typeof finding>, dismissalReason?: string): Promise<Mail> {
  await fireWebhook(o, "judge", {
    findingId: f.finding.id, finding: f.finding, finalScore: 90, originalScore: 80,
    overturns: 1, totalQuestions: 2, judgedBy: "judge@monsterrg.com", decisions: [], dismissalReason,
  });
  const mail = inbox(f.to);
  assertEquals(mail.length, 1, `one appeal email to ${f.to}`);
  return mail[0];
}

// ── REQ-031: package templates ──────────────────────────────────────────────

Deno.test("REQ-031: a package audit's email uses the package template, a date leg's the existing one", async () => {
  const o = org();
  const internal = await template(o, "INTERNAL {{resId}}");
  const partner = await template(o, "PARTNER {{subjectGuest}}");
  await config(o, "terminate", { emailTemplateId: internal, packageEmailTemplateId: partner });

  const leg = finding("dateleg", { GuestName: "Cathy Beck", ReservationId: "1243600" });
  assertEquals((await auditReport(o, leg)).Subject, "INTERNAL 1243600");

  const pkg = finding("package", { GuestName: "Pat Partner", ReservationId: "555" });
  assertEquals((await auditReport(o, pkg)).Subject, "PARTNER Pat Partner");
});

Deno.test("REQ-031: a package with no package template picked still gets the existing one", async () => {
  const o = org();
  await config(o, "terminate", { emailTemplateId: await template(o, "SHARED {{resId}}") });
  const pkg = finding("package", { GuestName: "Pat Partner" });
  assertEquals((await auditReport(o, pkg)).Subject, "SHARED Pat Partner");
});

Deno.test("REQ-031: a package dismissal uses the package dismissal template", async () => {
  const o = org();
  await config(o, "judge", {
    emailTemplateId: await template(o, "Your Appeal for {{resId}}: {{finalScore}}"),
    dismissalTemplateId: await template(o, "Your Appeal for {{resId}}: Dismissed"),
    packageEmailTemplateId: await template(o, "Your Appeal Result: {{finalScore}}"),
    packageDismissalTemplateId: await template(o, "Your Appeal was Dismissed"),
  });

  const leg = finding("dateleg", { GuestName: "Cathy Beck", ReservationId: "1243600" });
  assertEquals((await appealDecision(o, leg)).Subject, "Your Appeal for 1243600: 90%");
  const legDismissed = finding("dateleg", { GuestName: "Cathy Beck", ReservationId: "1243600" });
  assertEquals((await appealDecision(o, legDismissed, "no audio")).Subject, "Your Appeal for 1243600: Dismissed");

  const pkg = finding("package", { GuestName: "Pat Partner" });
  assertEquals((await appealDecision(o, pkg)).Subject, "Your Appeal Result: 90%");
  const pkgDismissed = finding("package", { GuestName: "Pat Partner" });
  assertEquals((await appealDecision(o, pkgDismissed, "no audio")).Subject, "Your Appeal was Dismissed");
});

// ── REQ-032: {{resId}} / {{resLink}} ────────────────────────────────────────

Deno.test("REQ-032: a date-leg subject names the bare reservation number", async () => {
  const o = org();
  await config(o, "terminate", { emailTemplateId: await template(o, "Audit for: {{resId}} {{passedOrFailed}}") });
  const leg = finding("dateleg", { GuestName: "Cathy Beck", ReservationId: "1243600" });
  assertEquals((await auditReport(o, leg)).Subject, "Audit for: 1243600 Passed");
});

Deno.test("REQ-032: a date leg with no reservation falls back to the guest", async () => {
  const o = org();
  await config(o, "terminate", {
    emailTemplateId: await template(o, "Audit for: {{resId}} {{passedOrFailed}}", "<p>{{resNoun}} {{resLink}}|{{resUrl}}|</p>"),
  });
  const leg = finding("dateleg", { GuestName: "Cathy Beck", ReservationId: "" });
  const mail = await auditReport(o, leg);
  assertEquals(mail.Subject, "Audit for: Cathy Beck Passed");
  assert(mail.HtmlBody.includes("<p>guest Cathy Beck||</p>"), `plain guest, no link: ${mail.HtmlBody}`);
});

Deno.test("REQ-032: the body links the reservation number to its QuickBase record", async () => {
  const o = org();
  await config(o, "terminate", {
    emailTemplateId: await template(o, "x", "<p>{{resNoun}} {{resLink}}|{{resUrl}}|</p>"),
  });
  const leg = finding("dateleg", { GuestName: "Cathy Beck", ReservationId: "1243600" });
  const body = (await auditReport(o, leg)).HtmlBody;
  assert(body.includes(`<p>reservation <a href="${RES_URL}1243600"`), `linked reservation: ${body}`);
  assert(body.includes(`>1243600</a>|${RES_URL}1243600|</p>`), `bare number as the link text: ${body}`);
  assert(!body.includes("Cathy Beck"), "no guest name on an internal email");
});

Deno.test("REQ-032: a package keeps the guest, never its reservation number", async () => {
  const o = org();
  await config(o, "terminate", {
    emailTemplateId: await template(o, "Audit for: {{resId}} {{passedOrFailed}}", "<p>{{resLink}}|{{resUrl}}|</p>"),
  });
  const pkg = finding("package", { GuestName: "Pat Partner", ReservationId: "555" });
  const mail = await auditReport(o, pkg);
  assertEquals(mail.Subject, "Audit for: Pat Partner Passed");
  assert(mail.HtmlBody.includes("<p>Pat Partner||</p>"), `guest, no reservation link: ${mail.HtmlBody}`);
});

// ── REQ-033: no guest names in the bundled internal emails ──────────────────

Deno.test("REQ-033: the bundled internal emails show the reservation, not the guest", async () => {
  const o = org();
  // No templates configured: judge and appeal-filed fall back to the bundled
  // defaults. Appeal-filed mails staff, so it needs a BCC to have a recipient.
  const staff = `staff-${crypto.randomUUID().slice(0, 8)}@monsterrg.com`;
  await config(o, "appeal", { bcc: staff });

  const leg = finding("dateleg", { GuestName: "Cathy Beck", ReservationId: "1243600" });
  const result = await appealDecision(o, leg);
  assert(result.HtmlBody.includes(`${RES_URL}1243600`), "appeal result links the reservation");
  assert(!result.HtmlBody.includes("Cathy Beck"), "appeal result names no guest");

  await fireWebhook(o, "appeal", { findingId: leg.finding.id, finding: leg.finding, comment: "please", appealedAt: Date.now() });
  const filed = inbox(staff);
  assertEquals(filed.length, 1);
  assert(filed[0].HtmlBody.includes(`${RES_URL}1243600`), "appeal filed links the reservation");
  assert(!filed[0].HtmlBody.includes("Cathy Beck") && !filed[0].Subject.includes("Cathy Beck"), "appeal filed names no guest");

  const pkg = finding("package", { GuestName: "Pat Partner", ReservationId: "555" });
  assert((await appealDecision(o, pkg)).HtmlBody.includes("Pat Partner"), "a package still names its guest");
});
