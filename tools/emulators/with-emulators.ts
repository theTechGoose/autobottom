/** Run a command with the emulator stack up, then tear it down.
 *
 *  Used by `deno task test`: the suite now talks to the Firestore emulator
 *  rather than an in-process Map, so something has to start it. Boots the
 *  stack, waits until Firestore and the S3 stand-in actually answer, runs the
 *  command, and kills everything on the way out — including on Ctrl-C, so a
 *  cancelled test run does not leave a Firestore emulator holding its port.
 *
 *  The run gets its OWN Firestore project, wiped first. The emulator keeps one
 *  document space per project id, so this gives the suite an empty database
 *  every time WITHOUT touching the seeded dev data sitting in the normal
 *  project — and stops whole-database scans (the watchdog walks every org)
 *  from tripping over that data.
 *
 *    deno run -A tools/emulators/with-emulators.ts deno test -A ...
 *
 *  If the stack is ALREADY running (you keep `deno task emulators` open in
 *  another terminal), it is reused as-is and left running afterwards. */

import { EMULATOR_PORTS } from "@core/config/endpoints.ts";

const REQUIRED = [EMULATOR_PORTS.firestore, EMULATOR_PORTS.s3, EMULATOR_PORTS.google, EMULATOR_PORTS.qstash];

/** Separate document space from the seeded dev project. */
const TEST_PROJECT = "autobottom-test";

async function wipeTestProject(): Promise<void> {
  const url = `http://127.0.0.1:${EMULATOR_PORTS.firestore}` +
    `/emulator/v1/projects/${TEST_PROJECT}/databases/(default)/documents`;
  const res = await fetch(url, { method: "DELETE" });
  await res.body?.cancel();
  if (!res.ok) throw new Error(`could not clear the test project: ${res.status}`);
  console.log(`🧪 cleared Firestore project "${TEST_PROJECT}"`);
}

async function portAnswers(port: number): Promise<boolean> {
  try {
    const conn = await Deno.connect({ hostname: "127.0.0.1", port });
    conn.close();
    return true;
  } catch {
    return false;
  }
}

async function allUp(): Promise<boolean> {
  for (const port of REQUIRED) if (!await portAnswers(port)) return false;
  return true;
}

const command = Deno.args.filter((a) => a !== "--");
if (command.length === 0) {
  console.error("usage: with-emulators.ts <command> [args...]");
  Deno.exit(2);
}

const alreadyRunning = await allUp();
let stack: Deno.ChildProcess | undefined;

if (alreadyRunning) {
  console.log("🧪 reusing the emulator stack already listening on 127.0.0.1");
} else {
  console.log("🧪 starting emulators…");
  stack = new Deno.Command(Deno.execPath(), {
    args: [
      "run", "-A", "--unstable-kv",
      "--env-file=autobottom.env", "--env-file=emulator.env",
      "tools/emulators/mod.ts",
    ],
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && !await allUp()) {
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!await allUp()) {
    console.error("❌ emulators did not come up in 90s (is Java installed? `brew install openjdk`)");
    try { stack.kill("SIGTERM"); } catch { /* already gone */ }
    Deno.exit(1);
  }
}

function shutdown() {
  if (!stack) return;
  try { stack.kill("SIGTERM"); } catch { /* already gone */ }
  stack = undefined;
}
Deno.addSignalListener("SIGINT", () => { shutdown(); Deno.exit(130); });
Deno.addSignalListener("SIGTERM", () => { shutdown(); Deno.exit(143); });

await wipeTestProject();

const child = new Deno.Command(command[0], {
  args: command.slice(1),
  // Set in the process environment, which beats --env-file: the suite runs in
  // emulator mode against its own throwaway project.
  env: { EMULATOR: "true", FIREBASE_PROJECT_ID: TEST_PROJECT },
  stdout: "inherit",
  stderr: "inherit",
}).spawn();

const { code } = await child.status;
shutdown();
Deno.exit(code);
