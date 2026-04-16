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

```bash
# All recent prod logs (200 lines)
deno task logs:prod

# All recent preview-deployment logs (branch previews)
deno task logs:preview

# Only lines containing "AUDIT" (filter defined in deno.json)
deno task logs:audit

# Only lines containing "QSTASH"
deno task logs:qstash
```

Pipe to grep/awk for further filtering:
```bash
deno task logs:prod 2>&1 | grep -E "❌|error" | head -50
deno task logs:prod 2>&1 | grep "📮 \[QSTASH\]" | tail -20
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
deno task logs:qstash | head -20
```

Look for lines like:
```
📮 [QSTASH] enqueueStep step=init callback=https://<deployment>.thetechgoose.deno.net/audit/step/init
```

If the callback URL is wrong, the SELF_URL fix didn't take effect on that deployment.

### 4. Did QStash deliver the callback?

```bash
deno task logs:audit | grep "step=init"
```

If you see the enqueue log but no step callback logs, QStash either didn't deliver, or delivered to the wrong deployment.

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
