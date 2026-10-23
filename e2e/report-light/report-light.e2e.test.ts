/** The audit report and the scrub view render in light mode (REQ-022 /
 *  REQ-023); the manager remediation view, which shares the scrub view's
 *  parts, stays dark.
 *
 *  Seeds a finished, failed audit into the emulator project `serve` reads and
 *  opens its public report and the Appeal Decision modal the way an agent
 *  does, checking the page, its panels and the modal are light with dark text. */
import { story } from "#shots";
import { saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { createUser } from "@core/business/auth/mod.ts";

const ORG = Deno.env.get("DEFAULT_ORG_ID") as unknown as Parameters<typeof saveFinding>[0];

/** Relative luminance (0 dark … 1 light) of a computed `rgb(...)` colour. */
function luminance(rgb: string): number {
  const [r, g, b] = (rgb.match(/\d+(\.\d+)?/g) ?? ["0", "0", "0"]).slice(0, 3).map((n) => {
    const c = Number(n) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

Deno.test("REQ-022: the audit report is light mode — light page, panels and modals with dark text", (t) =>
  story(t, async ({ page, expect }) => {
    const id = "e2e-light-" + crypto.randomUUID().slice(0, 8);
    await saveFinding(ORG, {
      id,
      findingStatus: "finished",
      answeredQuestions: [
        { header: "Correct Dates", populated: "Dates confirmed?", thinking: "Wrong date read", defense: "", answer: "No" },
        { header: "Correct Location", populated: "Location stated?", thinking: "Stated", defense: "", answer: "Yes" },
      ],
      completedAt: Date.now(),
      record: { RecordId: "900004", VoName: "DS MB - Demo Agent" },
      recordingId: "27694351",
      recordingIdField: "VoGenie",
      owner: "api",
    });
    await page.goto(`/audit/report?id=${id}`);

    // deno-lint-ignore no-explicit-any
    const colours = async (sel: string): Promise<any> => await page.locator(sel).first().evaluate((el: any) => {
      const s = (globalThis as any).getComputedStyle(el);
      return { bg: s.backgroundColor, fg: s.color };
    });

    const body = await colours("body");
    expect(luminance(body.bg) > 0.8, `the page background is light (${body.bg})`);
    expect(luminance(body.fg) < 0.2, `the page text is dark (${body.fg})`);
    const panel = await colours(".rpt-hero");
    expect(luminance(panel.bg) > 0.8, `the report header panel is light (${panel.bg})`);
    const q = await colours(".rpt-q");
    expect(luminance(q.bg) > 0.8, `a question card is light (${q.bg})`);

    await page.getByRole("button", { name: "Appeal Decision" }).click();
    const title = page.locator(".appeal-confirm-title");
    await title.waitFor();
    await page.waitForTimeout(400);
    await title.click();
    const modal = await colours(".appeal-overlay-box");
    expect(luminance(modal.bg) > 0.8, `the appeal modal is light (${modal.bg})`);
    const heading = await colours(".appeal-confirm-title");
    expect(luminance(heading.fg) < 0.2, `its heading is dark text (${heading.fg})`);
  }));

/** A finished, failed audit with a transcript the scrub view can list. */
async function scrubbableAudit(): Promise<string> {
  const id = "e2e-scrub-light-" + crypto.randomUUID().slice(0, 8);
  await saveFinding(ORG, {
    id,
    findingStatus: "finished",
    answeredQuestions: [
      { header: "Correct Dates", populated: "Dates confirmed?", thinking: "Wrong date read", defense: "[AGENT]: You arrive September 7.", answer: "No" },
      { header: "Correct Location", populated: "Location stated?", thinking: "Stated", defense: "[AGENT]: Orlando, Florida.", answer: "Yes" },
    ],
    completedAt: Date.now(),
    record: { RecordId: "900005", VoName: "DS MB - Demo Agent" },
    recordingId: "27694351",
    recordingIdField: "VoGenie",
    owner: "api",
    rawTranscript: "[AGENT]: You arrive September 7.\n[CUSTOMER]: Yes.\n[AGENT]: Orlando, Florida.",
    utteranceTimes: [0, 4000, 8000],
  });
  return id;
}

Deno.test("REQ-023: the scrub view is light mode, and the manager remediation view stays dark", (t) =>
  story(t, async ({ page, expect }) => {
    const id = await scrubbableAudit();
    // deno-lint-ignore no-explicit-any
    const colours = async (sel: string): Promise<any> => await page.locator(sel).first().evaluate((el: any) => {
      const s = (globalThis as any).getComputedStyle(el);
      return { bg: s.backgroundColor, fg: s.color };
    });

    await page.goto(`/audit/scrub?id=${id}`);
    const body = await colours("body");
    expect(luminance(body.bg) > 0.8, `scrub: the page background is light (${body.bg})`);
    expect(luminance(body.fg) < 0.2, `scrub: the page text is dark (${body.fg})`);
    for (const sel of [".rem-topbar", ".queue-left", ".queue-right"]) {
      const c = await colours(sel);
      expect(luminance(c.bg) > 0.8 || c.bg === "rgba(0, 0, 0, 0)", `scrub: ${sel} is light or transparent over the light page (${c.bg})`);
    }

    const email = `e2e-admin-${crypto.randomUUID().slice(0, 8)}@monsterrg.com`;
    await createUser(ORG, email, "e2e-pass-123", "admin");
    await page.goto("/login");
    await page.fill("input[name=email]", email);
    await page.fill("input[name=password]", "e2e-pass-123");
    await page.click("button[type=submit]");
    await page.waitForURL("**/admin/dashboard");
    await page.goto(`/manager/remediate/${id}`);
    const rem = await colours("body");
    expect(luminance(rem.bg) < 0.1, `remediation: the page background stays dark (${rem.bg})`);
    expect.eq(await page.locator("body.theme-light").count(), 0, "remediation: no light theme on the body");
  }));
