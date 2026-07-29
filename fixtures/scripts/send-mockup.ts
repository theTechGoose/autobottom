#!/usr/bin/env -S deno run -A --env-file=autobottom.env
/**
 * send-mockup.ts — email a self-contained HTML file (a report mockup) to
 * yourself for review, through the same Postmark sender the real reports use.
 *
 * Why: mockups in docs/ get reviewed in an inbox before they go to anyone
 * else. Previously that was a throwaway script each time; this one sticks
 * around so the next round is one command.
 *
 * Usage:
 *   deno run -A --env-file=autobottom.env fixtures/scripts/send-mockup.ts docs/ceo-report-mockup-flat.html
 *   ... send-mockup.ts docs/ceo-report-mockup-flat.html --subject="CEO report v2"
 *   ... send-mockup.ts docs/ceo-report-mockup-flat.html --to=someone@monsterrg.com
 *   ... send-mockup.ts docs/ceo-report-mockup-flat.html --attach=docs/ceo-report-page.html
 *   ... send-mockup.ts docs/ceo-report-mockup-flat.html --dry-run
 *
 * Required env (autobottom.env already has both):
 *   POSTMARK_SERVER   Postmark server token
 *   FROM_EMAIL        sender address (must be a verified Postmark sender)
 *
 * Optional env:
 *   REVIEW_EMAIL      default recipient when --to is omitted
 */

import { encodeBase64 } from "jsr:@std/encoding@^1.0.10/base64";
import { sendEmail } from "@reporting/domain/data/postmark/mod.ts";

const DEFAULT_REVIEW_EMAIL = "alexandera@monsterrg.com";

interface Args {
  file: string | null;
  to: string[];
  subject: string | null;
  from: string | null;
  attachments: string[];
  dryRun: boolean;
}

const USAGE = `send-mockup — email an HTML mockup to yourself for review

Usage:
  deno run -A --env-file=autobottom.env fixtures/scripts/send-mockup.ts <file.html> [options]

Options:
  --to=<email>       Recipient; repeat for several (default: $REVIEW_EMAIL or ${DEFAULT_REVIEW_EMAIL})
  --subject=<text>   Subject line (default: the HTML's <title>, else the filename)
  --from=<email>     Sender (default: $FROM_EMAIL)
  --attach=<path>    Attach a file; repeat for several
  --dry-run          Show what would be sent, send nothing
  --help, -h         This message`;

function parseArgs(argv: string[]): Args {
  const out: Args = { file: null, to: [], subject: null, from: null, attachments: [], dryRun: false };
  for (const a of argv) {
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--help" || a === "-h") {
      console.log(USAGE);
      Deno.exit(0);
    } else if (a.startsWith("--to=")) out.to.push(...splitEmails(a.slice(5)));
    else if (a.startsWith("--subject=")) out.subject = a.slice(10);
    else if (a.startsWith("--from=")) out.from = a.slice(7);
    else if (a.startsWith("--attach=")) out.attachments.push(a.slice(9));
    else if (a.startsWith("-")) throw new Error(`unknown arg: ${a}`);
    else if (out.file) throw new Error(`only one HTML file at a time (got "${out.file}" and "${a}")`);
    else out.file = a;
  }
  return out;
}

const splitEmails = (raw: string): string[] =>
  raw.split(",").map((e) => e.trim()).filter(Boolean);

/** Pull the <title> out for use as the subject, un-escaping the handful of
 *  entities our mockups actually use. */
function subjectFromHtml(html: string): string | null {
  const match = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (!match) return null;
  const text = match[1]
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

/** Email clients block or drop anything the message doesn't carry itself, so
 *  warn loudly rather than let a broken-looking mockup reach an inbox. */
function warnOnExternalAssets(html: string): void {
  const problems: string[] = [];
  const imgs = [...html.matchAll(/<img[^>]*\ssrc="([^"]*)"/gi)]
    .map((m) => m[1])
    .filter((src) => !src.startsWith("data:") && !src.startsWith("cid:"));
  if (imgs.length) problems.push(`${imgs.length} <img> pointing outside the email (e.g. ${imgs[0]})`);
  if (/<link[^>]*rel="stylesheet"/i.test(html)) problems.push("an external stylesheet <link>");
  if (/<script[\s>]/i.test(html)) problems.push("a <script> tag (email clients strip these)");

  if (problems.length) {
    console.warn("⚠️  This file is not fully self-contained:");
    for (const p of problems) console.warn(`   • ${p}`);
    console.warn("   It may look broken in the inbox. Inline the styles/images first.\n");
  }
}

const contentTypeFor = (path: string): string => {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  const known: Record<string, string> = {
    ".html": "text/html",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".pdf": "application/pdf",
    ".csv": "text/csv",
    ".md": "text/markdown",
  };
  return known[ext] ?? "application/octet-stream";
};

const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

async function main() {
  const args = parseArgs(Deno.args.slice());

  if (!args.file) {
    console.error("Missing the HTML file to send.\n");
    console.error(USAGE);
    Deno.exit(1);
  }

  const html = await Deno.readTextFile(args.file);
  warnOnExternalAssets(html);

  const to = args.to.length
    ? args.to
    : splitEmails(Deno.env.get("REVIEW_EMAIL") || DEFAULT_REVIEW_EMAIL);
  const subject = args.subject ?? subjectFromHtml(html) ?? basename(args.file);
  const from = args.from ?? Deno.env.get("FROM_EMAIL") ?? null;

  const attachments = await Promise.all(
    args.attachments.map(async (path) => ({
      name: basename(path),
      content: encodeBase64(await Deno.readFile(path)),
      contentType: contentTypeFor(path),
    })),
  );

  const sizeKb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
  console.log(`File:    ${args.file} (${sizeKb(new TextEncoder().encode(html).length)})`);
  console.log(`To:      ${to.join(", ")}`);
  console.log(`From:    ${from ?? "(FROM_EMAIL unset — sendEmail will fall back)"}`);
  console.log(`Subject: ${subject}`);
  if (attachments.length) {
    console.log(`Attach:  ${attachments.map((a) => `${a.name} (${sizeKb(a.content.length * 0.75)})`).join(", ")}`);
  }

  if (args.dryRun) {
    console.log("\n--dry-run: nothing sent.");
    return;
  }

  await sendEmail({
    to,
    subject,
    htmlBody: html,
    ...(from ? { from } : {}),
    ...(attachments.length ? { attachments } : {}),
  });

  console.log("\n✅ Sent.");
}

if (import.meta.main) {
  await main().catch((err) => {
    console.error(`\n❌ ${err.message}`);
    Deno.exit(1);
  });
}
