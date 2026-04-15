/** E2E test helpers — start server, create test sessions via pure fetch. */

const E2E_PORT = 3333;
export const BASE = `http://localhost:${E2E_PORT}`;

let serverProcess: Deno.ChildProcess | null = null;

/** Start the unified server on E2E_PORT. Returns when server is ready. */
export async function startServer(): Promise<void> {
  if (serverProcess) return; // already running

  const cmd = new Deno.Command("deno", {
    args: ["run", "-A", "--unstable-raw-imports", "--unstable-cron", "--unstable-kv", "main.ts"],
    env: { ...Deno.env.toObject(), PORT: String(E2E_PORT) },
    stdout: "piped",
    stderr: "piped",
  });
  serverProcess = cmd.spawn();

  // Wait for server to be ready (poll health endpoint)
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${BASE}/cron/status`);
      if (res.ok) {
        console.log(`[E2E] Server ready on port ${E2E_PORT}`);
        return;
      }
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error("E2E server failed to start within 30s");
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
    throw new Error(`Register failed: status=${regRes.status}, no cookie`);
  }

  // Login (to get a fresh session)
  const loginRes = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`,
    redirect: "manual",
  });
  const loginCookie = loginRes.headers.get("set-cookie") ?? "";
  const sessionMatch = loginCookie.match(/session=([^;]+)/);
  if (!sessionMatch) {
    throw new Error(`Login failed: status=${loginRes.status}, no cookie`);
  }

  return { cookie: `session=${sessionMatch[1]}`, email };
}
