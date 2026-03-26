/**
 * Integration test: Question Lab mode toggle via /api/qlab-mode
 *
 * Usage: SELF_URL=http://localhost:8000 deno run --allow-all --unstable-kv --env test-qlab-mode.ts
 */

const SELF = Deno.env.get("SELF_URL") ?? "http://localhost:8000";

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

async function get(path: string) {
  const r = await fetch(`${SELF}${path}`);
  return { status: r.status, data: await r.json() };
}

async function post(path: string, body: unknown) {
  const r = await fetch(`${SELF}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
}

console.log("\n==============================");
console.log("Question Lab Mode Toggle Tests");
console.log("==============================\n");

// --- 1. GET initial state ---
console.log("[1/5] GET /api/qlab-mode — initial state");
const initial = await get("/api/qlab-mode");
ok("200 status", initial.status === 200, `got ${initial.status}`);
ok("active is null or string", initial.data.active === null || typeof initial.data.active === "string");
ok("configs is array", Array.isArray(initial.data.configs));
console.log(`  active: ${JSON.stringify(initial.data.active)}, configs: ${initial.data.configs.length}`);

// --- 2. POST to switch to production (null) ---
console.log("\n[2/5] POST /api/qlab-mode — set to null (production)");
const setNull = await post("/api/qlab-mode", { configName: null });
ok("200 status", setNull.status === 200, `got ${setNull.status}`);
ok("ok: true", setNull.data.ok === true);
ok("active is null", setNull.data.active === null, `got ${JSON.stringify(setNull.data.active)}`);

// --- 3. GET confirms null ---
console.log("\n[3/5] GET /api/qlab-mode — confirm null");
const afterNull = await get("/api/qlab-mode");
ok("active is null", afterNull.data.active === null, `got ${JSON.stringify(afterNull.data.active)}`);

// --- 4. If configs exist, switch to one ---
const configs = initial.data.configs as Array<{ name: string }>;
if (configs.length > 0) {
  const testConfig = configs[0].name;
  console.log(`\n[4/5] POST /api/qlab-mode — set to "${testConfig}"`);
  const setConfig = await post("/api/qlab-mode", { configName: testConfig });
  ok("200 status", setConfig.status === 200, `got ${setConfig.status}`);
  ok("ok: true", setConfig.data.ok === true);
  ok(`active is "${testConfig}"`, setConfig.data.active === testConfig, `got ${JSON.stringify(setConfig.data.active)}`);

  // GET confirms
  const afterConfig = await get("/api/qlab-mode");
  ok("GET confirms active config", afterConfig.data.active === testConfig, `got ${JSON.stringify(afterConfig.data.active)}`);

  // Revert to production
  console.log(`\n[5/5] POST /api/qlab-mode — revert to production`);
  const revert = await post("/api/qlab-mode", { configName: null });
  ok("reverted ok", revert.data.ok === true && revert.data.active === null);
  const afterRevert = await get("/api/qlab-mode");
  ok("GET confirms null after revert", afterRevert.data.active === null);
} else {
  console.log("\n[4/5] SKIP — no configs in org (create one at /question-lab first)");
  console.log("[5/5] SKIP");
}

console.log(`\n==============================`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`==============================\n`);

if (failed > 0) Deno.exit(1);
