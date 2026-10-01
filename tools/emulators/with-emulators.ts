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
 *  another terminal), it is reused as-is and left running afterwards.
 *
 *  Several runs may share one stack at once — the gate runs `test:int` and
 *  `serve` side by side, and the emulator ports are fixed. A file lock keeps
 *  that safe: only one run starts the stack, every run holds a shared lock
 *  while its command runs, and the run that started the stack waits for an
 *  exclusive lock (every other run finished) before stopping it.
 *
 *  EMULATOR_PROJECT names the Firestore project (default "autobottom-test"),
 *  so concurrent runs each get their own wiped document space.
 *
 *  `--plan` anywhere in the command runs it straight away, with no stack: it
 *  only lists what the command would run (the gate asks this before a lane). */

import { EMULATOR_PORTS } from "@core/config/endpoints.ts";

const REQUIRED = [EMULATOR_PORTS.firestore, EMULATOR_PORTS.s3, EMULATOR_PORTS.google, EMULATOR_PORTS.qstash];

/** Separate document space from the seeded dev project. */
const TEST_PROJECT = Deno.env.get("EMULATOR_PROJECT") || "autobottom-test";

/** Machine-wide, like the ports it guards. */
const LOCK_PATH = `${Deno.env.get("TMPDIR") ?? "/tmp"}/autobottom-emulators.lock`;

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

if (command.includes("--plan")) {
  const { code } = await new Deno.Command(command[0], {
    args: command.slice(1), stdout: "inherit", stderr: "inherit",
  }).output();
  Deno.exit(code);
}

const lock = await Deno.open(LOCK_PATH, { create: true, read: true, write: true });
await lock.lock(true); // one run at a time decides whether to start the stack

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
await lock.unlock();
await lock.lock(false); // held while the command runs, so a starter waits for us

function shutdown() {
  if (!stack) return;
  try { stack.kill("SIGTERM"); } catch { /* already gone */ }
  stack = undefined;
}

/** Leave the stack the way we found it: drop our shared lock and, if we
 *  started the stack, stop it once every other run sharing it has finished. */
async function finish(code: number): Promise<never> {
  await lock.unlock();
  if (stack) {
    await lock.lock(true);
    shutdown();
  }
  Deno.exit(code);
}

let child: Deno.ChildProcess | undefined;
let signalCode = 0;
function onSignal(signal: Deno.Signal, code: number) {
  // Pass it on and let the normal path below finish up — exiting here would
  // orphan the command (a served app left holding its port) and stop a stack
  // other runs are still using.
  if (child) {
    signalCode = code;
    try { child.kill(signal); } catch { /* already gone */ }
  } else {
    finish(code);
  }
}
Deno.addSignalListener("SIGINT", () => onSignal("SIGINT", 130));
Deno.addSignalListener("SIGTERM", () => onSignal("SIGTERM", 143));

await wipeTestProject();

child = new Deno.Command(command[0], {
  args: command.slice(1),
  // Set in the process environment, which beats --env-file: the suite runs in
  // emulator mode against its own throwaway project.
  env: { EMULATOR: "true", FIREBASE_PROJECT_ID: TEST_PROJECT },
  stdout: "inherit",
  stderr: "inherit",
}).spawn();

const { code } = await child.status;
await finish(signalCode || code);
