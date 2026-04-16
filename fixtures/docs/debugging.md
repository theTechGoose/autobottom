# Debugging Live Deployments

## Deployctl Setup (one-time)

Install the Deno Deploy CLI:
```bash
deno install -gArf jsr:@deno/deployctl
```

Create an access token: https://app.deno.com/account#access-tokens

Add to your shell profile (`~/.zshrc` or `~/.bashrc`):
```bash
export DEPLOYCTL_TOKEN="your-token-here"
```

Reload your shell. Verify with `deployctl --version`.

## Log Tasks

All log tasks use the `DEPLOYCTL_TOKEN` env var.

### Finding the preview deployment ID

Branch preview log commands need `PREVIEW_ID` — the build hash from Deno Deploy.

1. Go to https://app.deno.com/thetechgoose/autobottom/builds
2. Click the latest build on your branch (e.g. `refactor/danet-backend`)
3. The URL ends with `/builds/<PREVIEW_ID>` — copy that hash
4. Or: the preview subdomain looks like `autobottom-<PREVIEW_ID>.thetechgoose.deno.net`

```bash
# Production logs (last 200 lines)
deno task logs:prod

# Branch preview logs — set PREVIEW_ID first
export PREVIEW_ID=28dd37bksa97
deno task logs:preview
# or 500 lines:
deno task logs:branch

# AUDIT/QSTASH filtering uses grep (works on both prod and preview)
deno task logs:prod 2>&1 | grep -E "AUDIT|QSTASH"
PREVIEW_ID=28dd37bksa97 deno task logs:preview 2>&1 | grep -E "AUDIT|QSTASH|STEP"
```

### Common filter patterns

```bash
# The full audit enqueue lifecycle for one audit
PREVIEW_ID=xxx deno task logs:preview 2>&1 | grep -E "🚀|📮|✅|❌"

# Only failures
deno task logs:prod 2>&1 | grep -E "❌|ERROR"

# QStash callback URLs (confirms ALS is writing the right origin)
deno task logs:prod 2>&1 | grep "📮 \[QSTASH\]"
```

## What to Check When Audits Don't Run

### 1. Is SELF_URL resolving correctly for THIS deployment?

```bash
curl https://<your-deployment>.thetechgoose.deno.net/admin/debug/self-url \
  -H "cookie: session=$SESSION_COOKIE"
```

Returns:
```json
{
  "selfUrl": "https://<your-deployment>.thetechgoose.deno.net",
  "envSelfUrl": "https://autobottom.thetechgoose.deno.net",
  "source": "async-local-storage"
}
```

- `source: "async-local-storage"` means the AsyncLocalStorage fix is active — QStash callbacks go to THIS deployment. Good.
- `source: "env"` means we fell back to the env var — callbacks go to whatever SELF_URL says. On a branch preview that's wrong (goes to main).

### 2. What's actually in KV for my org?

```bash
curl https://<your-deployment>.thetechgoose.deno.net/admin/debug/kv-state \
  -H "cookie: session=$SESSION_COOKIE"
```

Returns the current `active-tracking` entries, `completedCount`, and sample recent completed + errors.

### 3. Did enqueueStep actually call QStash with the right URL?

```bash
PREVIEW_ID=xxx deno task logs:preview 2>&1 | grep "📮"
```

Look for lines like:
```
📮 [QSTASH] enqueueStep step=init callback=https://<deployment>.thetechgoose.deno.net/audit/step/init
```

If the callback URL is wrong, the SELF_URL fix didn't take effect on that deployment.

### 4. Did QStash deliver the callback?

```bash
PREVIEW_ID=xxx deno task logs:preview 2>&1 | grep "\[STEP-INIT\]"
```

If you see the enqueue log (📮) but no `[STEP-INIT]` log lines, QStash either didn't deliver, or delivered to the wrong deployment (check the callback URL from step 3).

### 5. Did trackActive run? (The queued state marker)

The audit controller calls `trackActive(orgId, findingId, "queued", ...)` RIGHT AFTER enqueueing to QStash. This is what makes the audit appear in the Active Audits table instantly, without waiting for QStash delivery.

```bash
PREVIEW_ID=xxx deno task logs:preview 2>&1 | grep -E "trackActive|🚀 \[AUDIT\]"
```

Expected successful flow (in this order):
```
🚀 [AUDIT] Date-leg audit started: job=X finding=Y rid=Z orgId=monsterrg
📮 [QSTASH] enqueueStep step=init callback=https://<preview>/audit/step/init
✅ [AUDIT] trackActive(queued) succeeded orgId=monsterrg finding=Y
```

If you see `❌ [AUDIT] trackActive FAILED`, the error message tells you why. Common causes:
- KV connection lost mid-request
- orgId is undefined or empty
- Key format collision with another writer

**Shortcut:** the `/api/admin/test-audit` endpoint now returns this status inline. When you click "Start Audit" on the dashboard, the response shows:
- ✅ Green audit ID link if everything worked
- 📮 Callback URL if enqueue succeeded (confirms ALS)
- ⚠️ Yellow warning if enqueue or trackActive failed, with the actual error

No log access needed for the common failure modes.

## Environment Variables Reference

### Required in every deployment
- `KV_URL` — Deno KV database URL
- `QSTASH_TOKEN` — Upstash QStash bearer token
- `QSTASH_URL` — `https://qstash-us-east-1.upstash.io` (or your region)
- `SELF_URL` — **fallback only**; AsyncLocalStorage auto-detects per-request origin
- `CHARGEBACKS_ORG_ID` — the active org ID (e.g. `monsterrgc`)

### Optional
- `LOCAL_QUEUE=true` — skip QStash entirely, run steps via `setTimeout` (dev only)
- `S3_BUCKET` or `AWS_S3_BUCKET` — for audio recording streaming

## Known Issues

### "Audits stuck at findingStatus: pending" on branch previews

Root cause: branch preview deployments can't have per-deployment SELF_URL (hostname is auto-generated with a hash). If AsyncLocalStorage falls back to env, QStash callbacks land on main prod instead of the preview.

Fix: already deployed — `main.ts` wraps every request in `runWithOrigin(new URL(req.url).origin, ...)`. `selfUrl()` in `src/core/data/qstash/mod.ts` reads from AsyncLocalStorage first. Verify with `/admin/debug/self-url`.

### "QuickBase query failed: Unknown Hostname" in E2E tests

Root cause: tests don't have QB credentials configured. The `createSafeTestAudit()` helper in `tests/e2e/dashboard.test.ts` skips gracefully when this happens. Not a real bug.
