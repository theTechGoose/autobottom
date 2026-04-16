/** E2E test helpers — start server, create test sessions via pure fetch. */

const E2E_PORT = 3333;
export const BASE = `http://localhost:${E2E_PORT}`;

let serverProcess: Deno.ChildProcess | null = null;

/** Build the Fresh frontend so route changes are picked up in _fresh/ cache.
 *  Required because main.ts imports ./frontend/_fresh/server.js which caches the route map. */
async function buildFrontend(): Promise<void> {
  const buildCmd = new Deno.Command("deno", {
    args: ["run", "-A", "--unstable-raw-imports", "build.ts"],
    cwd: "frontend",
    stdout: "null",
    stderr: "null",
  });
  const { success } = await buildCmd.output();
  if (!success) throw new Error("Frontend build failed");
  console.log("[E2E] Frontend built");
}

/** Start the unified server on E2E_PORT. Returns when server is ready. */
export async function startServer(): Promise<void> {
  if (serverProcess) return;

  // Rebuild frontend so any new sub-routes are included in _fresh/ cache
  await buildFrontend();

  // Kill anything on the port first
  try {
    const lsof = new Deno.Command("lsof", { args: ["-ti", `:${E2E_PORT}`], stdout: "piped" });
    const out = await lsof.output();
    const pids = new TextDecoder().decode(out.stdout).trim();
    if (pids) {
      for (const pid of pids.split("\n")) {
        try { Deno.kill(parseInt(pid), "SIGTERM"); } catch { /* ok */ }
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  } catch { /* no process on port */ }

  const cmd = new Deno.Command("deno", {
    args: ["run", "-A", "--unstable-raw-imports", "--unstable-cron", "--unstable-kv", "main.ts"],
    env: { ...Deno.env.toObject(), PORT: String(E2E_PORT) },
    stdout: "null",  // discard — prevents pipe buffer blocking
    stderr: "null",
  });
  serverProcess = cmd.spawn();

  // Poll until server responds
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${BASE}/cron/status`);
      if (res.ok) {
        await res.body?.cancel();
        console.log(`[E2E] Server ready on port ${E2E_PORT}`);
        return;
      }
      await res.body?.cancel();
    } catch { /* not ready */ }
    await new Promise(r => setTimeout(r, 500));
  }
  stopServer();
  throw new Error("E2E server failed to start within 20s");
}

/** Stop the server subprocess. */
export function stopServer(): void {
  if (serverProcess) {
    try { serverProcess.kill("SIGTERM"); } catch { /* already dead */ }
    serverProcess = null;
    console.log("[E2E] Server stopped");
  }
}

/** Register a new org + login, return the session cookie string. */
export async function createTestSession(): Promise<{ cookie: string; email: string }> {
  const ts = Date.now();
  const email = `e2e-${ts}@test.local`;
  const password = "e2e-test-pass";
  const orgName = `E2E-Org-${ts}`;

  // Register
  const regRes = await fetch(`${BASE}/api/register`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `orgName=${encodeURIComponent(orgName)}&email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`,
    redirect: "manual",
  });
  const regCookie = regRes.headers.get("set-cookie") ?? "";
  if (!regCookie.includes("session=")) {
    const body = await regRes.text().catch(() => "");
    throw new Error(`Register failed: status=${regRes.status}, body=${body.slice(0, 200)}`);
  }

  // Login
  const loginRes = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`,
    redirect: "manual",
  });
  const loginCookie = loginRes.headers.get("set-cookie") ?? "";
  const sessionMatch = loginCookie.match(/session=([^;]+)/);
  if (!sessionMatch) {
    const body = await loginRes.text().catch(() => "");
    throw new Error(`Login failed: status=${loginRes.status}, body=${body.slice(0, 200)}`);
  }

  return { cookie: `session=${sessionMatch[1]}`, email };
}
