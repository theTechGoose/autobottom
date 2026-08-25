/** Test runner: parallel where it is safe, sequential where it is not.
 *
 *  `deno test --parallel` does NOT give each file its own process — every file
 *  runs in ONE process and async tests interleave (verified: two files see each
 *  other's `Deno.env.set`). Most of this suite is fine with that, because tests
 *  isolate by unique org id. Two kinds of file are not:
 *
 *    1. Files that write process env. `DEFAULT_ORG_ID`, `CANARY_SECRET` and
 *       friends are how a test configures the code under test — a second file
 *       overwriting one mid-await makes a controller read a different org and
 *       return nothing. That produced a different pair of failures on every run.
 *
 *    2. Files that scan the WHOLE database. runWatchdog() walks every org, so
 *       it counts findings other files are in the middle of creating.
 *
 *  Those run in a second, sequential pass once the parallel pass is finished.
 *  Membership is detected from the file contents, not a hand-kept list, so a
 *  new test that sets env is classified correctly without anyone remembering.
 *
 *    deno run -A tools/run-tests.ts [path ...]      (default: src/)
 */

const DENO_TEST_FLAGS = [
  "-A",
  "--unstable-raw-imports",
  "--unstable-kv",
  "--env-file=autobottom.env",
  "--env-file=emulator.env",
];

/** Sequential-only, and why. Content-matched so it keeps working as tests move. */
const NOT_PARALLEL_SAFE: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /Deno\.env\.(set|delete)\(/, reason: "writes process env" },
  { pattern: /runWatchdog\(|getStuckFindings\(/, reason: "scans every org" },
];

async function collect(root: string): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of Deno.readDir(root)) {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory) out.push(...await collect(path));
    else if (/(^|\.)(test|smk\.test|e2e\.test)\.ts$/.test(entry.name)) out.push(path);
  }
  return out;
}

function classify(source: string): string | null {
  for (const { pattern, reason } of NOT_PARALLEL_SAFE) {
    if (pattern.test(source)) return reason;
  }
  return null;
}

async function runDenoTest(files: string[], parallel: boolean): Promise<number> {
  if (files.length === 0) return 0;
  const args = ["test", ...DENO_TEST_FLAGS, ...(parallel ? ["--parallel"] : []), ...files];
  const child = new Deno.Command(Deno.execPath(), { args, stdout: "inherit", stderr: "inherit" }).spawn();
  return (await child.status).code;
}

const roots = Deno.args.length > 0 ? Deno.args : ["src"];
const files: string[] = [];
for (const root of roots) files.push(...await collect(root));

const parallelFiles: string[] = [];
const serialFiles: Array<{ file: string; reason: string }> = [];
for (const file of files) {
  const reason = classify(await Deno.readTextFile(file));
  if (reason) serialFiles.push({ file, reason });
  else parallelFiles.push(file);
}

const reasons = new Map<string, number>();
for (const { reason } of serialFiles) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
console.log(
  `🧪 ${parallelFiles.length} file(s) in parallel, ${serialFiles.length} sequential ` +
    `(${[...reasons].map(([r, n]) => `${n} ${r}`).join(", ")})`,
);

const parallelCode = await runDenoTest(parallelFiles, true);
const serialCode = await runDenoTest(serialFiles.map((s) => s.file), false);

if (parallelCode !== 0 || serialCode !== 0) {
  console.error(
    `\n❌ tests failed (parallel pass ${parallelCode === 0 ? "ok" : "FAILED"}, ` +
      `sequential pass ${serialCode === 0 ? "ok" : "FAILED"})`,
  );
}
Deno.exit(parallelCode !== 0 ? parallelCode : serialCode);
