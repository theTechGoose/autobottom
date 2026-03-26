# Refactor Plan: autobottom

## Baseline: What Exists

**Runtime**: Deno TypeScript, deployed to Deno Deploy. No `deno.json` config file.
**Total TS files**: 56 files, ~22,000 lines.
**Tests**: Zero. `test-qlab.ts` and `test-single.ts` are ad-hoc scripts, not structured tests.
**Structure**: Flat root. No `src/` directory. No separation of business/data/coordinator layers.

### Critical Violations Against Target Format

| Violation                          | Evidence                                                                                    | Severity                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------- |
| No `deno.json`                     | Glob returned zero matches                                                                  | Blocker — no task runner, no test config |
| No `src/` directory                | All code at root or one level deep                                                          | Structural                               |
| Standalone function exports        | Every module (kv.ts, groq.ts, etc.) exports bare functions                                  | Structural                               |
| No DTOs                            | `types/mod.ts` has plain interfaces, zero runtime validation                                | Boundary                                 |
| No business/data/coordinator split | Pipeline steps mix KV writes, LLM calls, and business logic in single functions             | Structural                               |
| Monolith router                    | `main.ts` is 2,341 lines with 80+ routes, inline handlers, auth middleware, HTML generation | Structural                               |
| Duplicated helpers                 | `json()` helper duplicated in 8 files                                                       | Code quality                             |
| No test infrastructure             | No test runner, no assertions, no mocking                                                   | Blocker                                  |
| Page files are raw HTML strings    | `dashboard/page.ts` (1,555 lines), `manager/page.ts` (1,544 lines) of template literals     | Frontend                                 |

---

## Safety Invariants (Apply to ALL Phases)

These rules override any phase-specific instructions. Violations are blockers.

### S1. Validation Gates — You Are the CI

There is no CI pipeline. The agent performing this migration validates at every step. No exceptions.

**Per-slice validation**: After completing a slice, run the tests that cover the moved/changed code plus any tests that import from the changed modules. If any fail, the slice is not complete. Additionally, **confirm the server starts** after every slice from Slice 4 onward (`deno run --check main.ts` or `deno task dev` with an immediate health-check `GET /`). `main.ts` has no unit tests — import resolution errors from moved modules will only surface when the server boots. Do not wait for E2E gates to catch these.

**Dynamic import validation**: `main.ts` uses `await import()` for lazy loading at runtime. These string-literal paths are invisible to `deno check` and will not break at boot — they break only when the specific handler is invoked. After ANY slice that moves a module, run:

```bash
grep -n "await import(" main.ts
```

Known dynamic imports (as of baseline):
| Line | Path | Moved In |
|------|------|----------|
| `main.ts:1342` | `./lib/kv.ts` | Slice 4 (re-export shim covers this) |
| `main.ts:1434` | `./manager/kv.ts` | Slice 14 |
| `main.ts:1578` | `./question-lab/kv.ts` | Slice 19 |
| `main.ts:2120` | `./lib/kv.ts` | Slice 4 (re-export shim covers this) |

When a slice moves one of these targets, **update the dynamic import path in `main.ts` in the same slice** — or confirm the re-export shim at the old path resolves it. Do not leave broken dynamic imports for Slice 21 to clean up; they will silently break production code paths (seeding, event emission) between the move and the main.ts decomposition.

**Per-phase validation**: At the end of every phase, run the full test suite (all unit + integration tests). All must pass before the next phase begins.

**E2E validation**: Run E2E tests at every phase boundary AND after any slice that modifies entrypoints or routing (Slices 20, 21 in Phase 2; all F-slices in Phase 4).

No slice or phase is "done" until its validation gate passes. If a test fails, diagnose and fix before proceeding.

### S2. Function→Class Migration — Test-First, Atomic Per Module

Every module converts from standalone function exports to class exports. This is NOT deferred. The procedure for each module:

1. **Phase 1** writes tests against the current function API (the functions as they exist today)
2. **Phase 0.3** creates `kv-factory.ts` — all KV modules use this shared factory, eliminating private singletons. This is the prerequisite that makes class constructor injection safe.
3. **Phase 2**, when a module moves in its slice:
   a. Create the class with constructor-injected dependencies (KV instance from factory, external clients)
   b. Keep the old function names as module-level wrappers that instantiate the class using the factory and delegate:
      ```ts
      // Old API preserved as wrapper
      export async function populateReviewQueue(orgId: OrgId, findingId: string, questions: AnsweredQuestion[]) {
        const svc = new ReviewQueueService(await kvFactory());
        return svc.populateQueue(orgId, findingId, questions);
      }
      ```
   c. Run Phase 1 tests — they call the old function names and must pass unchanged
   d. Update all callers **within this slice** to use the class directly
   e. Delete wrappers only after all callers are updated

4. **Cross-slice callers**: If a function is called from a module in a different slice (e.g., `populateManagerQueue` called from `review/kv.ts`), the wrapper stays until that caller's slice migrates. The wrapper is the compatibility bridge.

5. **No dual singletons**: The class does NOT create its own KV connection. It receives one via constructor. The wrapper gets it from `kv-factory.ts`. One factory, one connection, two calling conventions (old functions, new class) during the transition.

### S3. DTO-First KV Schema Freeze

DTOs define the wire format. They are written BEFORE any code moves and frozen via snapshot tests.

**Procedure:**

1. **Phase 1.0** (new sub-phase, before any other Phase 1 work): Write Zod schemas in `dto/` for every data shape persisted to KV or sent over the wire.
2. Derive schemas from the actual data shapes in the code. Where the code uses `Record<string, any>` (e.g., `getFinding` in `lib/kv.ts`), use `.passthrough()` initially to avoid rejecting unknown fields.
3. For each DTO, write a snapshot test: parse a known fixture through the schema, serialize it, assert the output matches the fixture exactly.
4. Integration tests (Phase 1.2) validate that Zod schemas accept real KV round-trip data. If a schema rejects data that the current code produces, the schema is wrong — fix the schema, not the data.
5. From this point forward, **the DTOs are frozen**. Any refactor that changes a data shape fails the snapshot test. This is intentional — data structure changes require explicit, deliberate DTO updates with new snapshots.
6. Both business and data layers import types from `dto/` only. No cross-layer type imports.

**KV Key Schema**: `orgKey()` in `lib/org.ts:5` builds all KV key tuples as `[orgId, ...parts]`. The key schema (which string literals are used as parts) is documented in the DTOs and must not change during the refactor. Add a key-schema snapshot test that asserts the set of known key prefixes.

### S4. Business/Data Separation — Data Is Wire Types

Per `ref/logic-classification.md`: business logic and data logic can only import from `dto/`. Data logic handles external IO (KV reads/writes, API calls). Business logic handles domain rules (filtering, transformation, validation). Coordinators join them via the sandwich pattern: data → business → data.

**Data layer** (`src/domain/data/`): Thin IO operations. Accepts and returns DTO types. No filtering, no conditional logic beyond error handling. Examples: `writeQueueItems(orgId, items)`, `readDecisions(orgId, findingId)`, `writeFinding(orgId, finding)`.

**Business layer** (`src/domain/business/`): Pure functions/classes that transform data. No IO imports. Examples: `selectItemsForReview(answeredQuestions)` returns items where `answer === "No"`; `buildManagerQueueItem(finding, confirmedFailures)` constructs the queue item shape.

**Coordinators** (`src/domain/coordinators/`): Orchestrate the sandwich. Example:
```ts
// coordinator: populate-review-queue
const questions = await kvData.getAnsweredQuestions(orgId, findingId);  // data (read)
const items = reviewBusiness.selectItemsForReview(questions);           // business (filter)
await kvData.writeReviewQueueItems(orgId, findingId, items);           // data (write)
```

This replaces the current plan's proposal to put everything in `src/domain/data/kv/queue-routing.ts` (which would put business logic in the data layer).

### S5. E2E Tests at Every Phase

Every phase has E2E validation. The scope varies by phase.

| Phase | E2E Scope | Rationale |
|-------|-----------|-----------|
| Phase 0 | Smoke: server starts, GET `/` returns 200 | Proves infrastructure works |
| Phase 1 | Critical paths: login, trigger audit, complete review decision (3-5 specs) | Proves current behavior is captured. Minimal — this tests template HTML that Phase 4 replaces. |
| Phase 2 | Run Phase 1 E2E at phase boundary + after Slices 20-21 (entrypoint changes) | Proves structural moves didn't break user-facing routes |
| Phase 3 | Run Phase 2 E2E unchanged | Proves cleanup didn't break anything |
| Phase 4 | Comprehensive Fresh E2E suite (~9 specs, ~30 cases) — NEW, not reused from Phase 1 | This is the permanent suite against the final architecture |

Phase 1-3 E2E is intentionally minimal. The template literal HTML is throwaway. Investment goes into Phase 4's Fresh E2E which tests the permanent architecture.

---

## Phase 0: Infrastructure (Must Complete First)

### 0.1 Create `deno.json`

Config with:

- `compilerOptions` for strict TypeScript
- `tasks` for `dev`, `test`, `test:e2e`, `lint`, `fmt`
- `imports` map for shared deps (`nanoid`, `groq-sdk`, `openai`)

### 0.2 Set Up Deno Test Infrastructure

- Deno's built-in `Deno.test()` for unit + integration tests
- Playwright (via `@playwright/test`) for E2E tests (separate `e2e/` directory). The ref spec says "Cypress tests" for E2E, but Cypress requires a separate Node.js runtime alongside Deno. Playwright is recommended here because: (a) the project already uses Playwright MCP integration (`.playwright-mcp/` exists), (b) it avoids dual-runtime complexity. **If you prefer Cypress per the ref, it will work — it just needs Node.js installed alongside Deno for the test runner.**
- Create test utilities: mock KV, mock fetch, assertion helpers
- **Add a `deno task test` pre-commit hook** — there are 32+ mandatory validation gates across this refactor with no CI pipeline. Every gate is manually verified without this. A pre-commit hook that runs `deno test` converts every `git commit` into an automatic gate check, catching regressions at the earliest possible moment instead of discovering them at a phase boundary. This is the cheapest investment with the highest ROI across the entire refactor.

### 0.3 KV Dependency Injection (PREREQUISITE for integration tests)

The codebase has **20+ `Deno.openKv()` call sites** across three categories:

**Category A — 7 lazy singletons** (private, not injectable):

```ts
let _kv: Deno.Kv | undefined;
async function kv(): Promise<Deno.Kv> {
  if (!_kv) _kv = await Deno.openKv();
  return _kv;
}
```

Found in: `lib/kv.ts:6`, `auth/kv.ts:8`, `review/kv.ts:13`, `judge/kv.ts`, `manager/kv.ts:12`, `agent/kv.ts:10`, `providers/groq.ts:14`.

**Category B — 9 inline calls in `main.ts`** (no singleton, opens fresh connection per handler):

Found at: `main.ts:168`, `main.ts:447`, `main.ts:1382`, `main.ts:1745`, `main.ts:1795`, `main.ts:1831`, `main.ts:1914`, `main.ts:1958`, `main.ts:2008`.

These are bare `const db = await Deno.openKv()` inside route handlers. Each call opens a new connection — no caching, no shared handle. In production this means multiple simultaneous connections per request. All 9 must migrate to the factory.

**Category C — 1 non-caching factory in `question-lab/kv.ts:44-46`**:

```ts
async function kv() { return await Deno.openKv(); }
```

Unlike every other module's lazy singleton, this creates a **new connection on every call** — no `_kv` cache. `steps/prepare.ts:7` imports `serveConfig` from this module, meaning every pipeline prepare step leaks a KV connection. Migration requires adding the lazy cache, not just swapping the import.

**Category D — 3 throwaway scripts** (not production, but must still be addressed for the grep gate):

`test-qlab.ts:42`, `test-single.ts:4`, `review/seed-test.ts:3`. These are ad-hoc scripts deleted in Phase 3.1, but they will cause the post-migration grep gate to fail if still present. Either delete them in Phase 0.3 or exclude them from the gate pattern.

---

These singletons and inline calls are **private** — there is no way to inject a test KV instance from outside. Before writing ANY integration test, every call site needs to use the shared factory.

**Approach**: Add a shared `kv-factory.ts` that all modules import. In test mode (`DENO_KV_PATH=:memory:`), it returns an in-memory instance. This is NOT a small change — it touches `main.ts` (2,341 lines) and 10+ other files on day one. Plan for it.

**Migration checklist for Phase 0.3:**

| Category | Sites | Action |
|----------|-------|--------|
| A: Lazy singletons | 7 files | Replace private `kv()` with import from `kv-factory.ts` |
| B: main.ts inline | 9 call sites | Replace `await Deno.openKv()` with `await kvFactory()` |
| C: question-lab/kv.ts | 1 file | Add lazy cache (`_kv` pattern), then swap to factory |
| D: Throwaway scripts | 3 files | Delete now (they're dead code) or exclude from grep gate |

**Also apply lazy-init to `lib/s3.ts`**: `lib/s3.ts:6-8` reads `AWS_REGION`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` at **module scope** — bare `const` declarations that execute the moment any file imports from `lib/s3.ts`. The `!` non-null assertions silently produce `undefined` at runtime if the env vars are missing. Any integration test that transitively imports a module depending on `lib/s3.ts` (e.g., `steps/init.ts`, `steps/transcribe.ts`, `steps/prepare.ts`) will fail on import unless AWS env vars are set. **Fix**: Refactor `lib/s3.ts` to use the same lazy-init pattern as KV — move credential reads into a `getS3Client()` factory function. This runs alongside the `kv-factory.ts` change in Phase 0.3.

**Post-migration verification**: After Phase 0.3 completes, run `grep -r "Deno.openKv" --include="*.ts"` across the codebase. The result MUST return only `kv-factory.ts`. Any other hit means a call site was missed and must be migrated. If both the factory and a direct `Deno.openKv()` call coexist, tests pass (both connect to `:memory:`) but production silently opens two separate KV handles with potentially inconsistent state.

### 0.4 Add `.worktrees` to `.gitignore`

Current `.gitignore` only has `.env` and `seed-data.json`. Need `.worktrees/` for parallel work.

---

## Phase 1: Baseline Test Coverage (Before Any Refactor)

Every function gets a test BEFORE it moves. No moving code without a green test that proves it works.

### 1.pre Characterization Tests — Lock In Existing Behavior (BEFORE DTOs)

**Why this exists**: Phase 1.0 introduces Zod DTOs (new code) and Phase 1.0.1 eliminates `as any` casts (production code changes). Both modify the codebase BEFORE behavioral tests exist. If removing an `as any` cast changes runtime behavior (it can — loose typing sometimes hides real shape mismatches), there are no tests to catch the regression. Characterization tests protect against this.

**Scope**: Write lightweight characterization tests for the functions most affected by Phase 1.0.1's cast elimination:

| Function | File | Why |
|----------|------|-----|
| `handleAuditByRid` / `handlePackageByRid` | `controller.ts` | Lines 36, 104, 193+ use `finding as Record<string, any>` — cast removal changes type narrowing |
| `stepFinalize` | `steps/finalize.ts` | Lines 41, 105, 116, 138, 253-254 use `as any[]` / `as Record<string, any>` on findings and questions |
| `populateReviewQueue` | `review/kv.ts` | Line 513 uses `as any[]` on answeredQuestions |

These tests call the functions with known inputs and assert outputs match. They use the EXISTING types and casts — no Zod, no DTO imports. They are the safety net that catches regressions when Phase 1.0.1 removes the casts.

**Gate**: All characterization tests pass before Phase 1.0 begins.

### 1.0 DTO-First — Write Wire Types and Freeze Them (see Safety Invariant S3)

After characterization tests lock in behavior, define the data shapes. DTOs are the contract between layers and the schema for persisted data.

**WARNING — Schema Discovery Is Archaeological, Not Mechanical**

The TypeScript interfaces in `types/mod.ts` do NOT define the actual wire shapes. The true shapes are wider:
- `lib/kv.ts:79` `saveFinding` accepts `Record<string, any>`, not typed `AuditFinding` — the actual persisted shape is whatever callers pass
- `steps/finalize.ts:41` accesses `(finding as Record<string, any>).appealSourceFindingId` — a field that does NOT appear in the `AuditFinding` interface at `types/mod.ts:70-99`
- `manager/kv.ts:82` has `finding.record?.RecordId ?? finding.record?.id` — the `record` field has no typed shape, and the fallback chain reveals it varies between QuickBase and test data
- `controller.ts:36` merges external QuickBase data into `body: Record<string, any>` — the shape depends on an external API

**Before writing ANY Zod schema**, run this for each type:
```bash
grep -rn "as any\|as Record<string, any>\|as any\[\]" --include="*.ts" | grep -i "<type-name>"
```
Then trace every property access on `as any`-casted variables to discover fields that exist only at runtime. Build the schema from **call-site evidence**, not interface declarations. A schema that is too strict will reject production data; one that matches only the interface will miss fields that live behind `as any` casts.

**Procedure:**

1. Create `dto/` directory with Zod schemas for every persisted/wire type:

| DTO File | Source | Key Shapes |
|----------|--------|------------|
| `dto/audit-finding.ts` | `types/mod.ts:70-99` (AuditFinding interface) | 22 fields, many optional. Use `.passthrough()` for fields accessed via `Record<string, any>` casts (e.g., `appealType`, `appealComment`, `reAuditedAt`) |
| `dto/audit-job.ts` | `types/mod.ts:30-68` (AuditJob interface) | Job metadata, status, timestamps |
| `dto/question.ts` | `types/mod.ts:1-28` (IQuestion, IQuestionSeed, IAnsweredQuestion) | Question shapes used throughout pipeline |
| `dto/review.ts` | `review/kv.ts:19-53` (ReviewItem, ReviewDecision, ReviewerLeaderboardEntry, ReviewerDashboardData) | Review queue wire types |
| `dto/judge.ts` | `judge/kv.ts:18-59` (JudgeItem, JudgeDecision, AppealRecord, AppealStats, AppealHistory) | Judge queue wire types |
| `dto/manager.ts` | `manager/kv.ts:18-48` (ManagerQueueItem, ManagerRemediation, RemediationResult) | Manager queue wire types |
| `dto/auth.ts` | `auth/kv.ts` (user, org, session shapes) | Auth wire types |
| `dto/gamification.ts` | `shared/badges.ts` (BadgeDef, EarnedBadge, BadgeCheckState) | Badge/store wire types |
| `dto/webhook.ts` | `lib/kv.ts` (webhook config shape) | Webhook config |
| `dto/store.ts` | `shared/badges.ts` (StoreItem, STORE_CATALOG shape) | Store catalog |

2. For each DTO, write a snapshot test:
   ```ts
   Deno.test("ReviewItem schema snapshot", () => {
     const fixture: ReviewItem = {
       findingId: "f-123",
       questionIndex: 0,
       header: "Was the greeting delivered?",
       populated: "Was the greeting delivered for call RID-456?",
       thinking: "The agent said hello...",
       defense: "Agent greeted the customer at 0:15",
       answer: "No",
     };
     const parsed = ReviewItemSchema.parse(fixture);
     assertEquals(parsed, fixture);
   });
   ```

3. Write a KV key-schema snapshot test that asserts the set of known key prefixes:
   ```ts
   Deno.test("KV key prefixes are frozen", () => {
     const KNOWN_PREFIXES = [
       "review-pending", "review-decided", "review-lock", "review-audit-pending",
       "judge-pending", "judge-decided", "judge-lock", "judge-audit-pending",
       "manager-queue", "manager-remediation",
       "audit-finding", "audit-job", "audit-active", "audit-completed", "audit-error",
       "appeal", "appeal-stats", "appeal-history",
       "badge-stats", "earned-badges", "xp-state",
       "qlab",
       // ... all prefixes from orgKey() usage
     ];
     // This test exists to make key prefix changes VISIBLE.
     // If you need to add a prefix, add it here first.
     assertEquals(KNOWN_PREFIXES.length, EXPECTED_COUNT);
   });
   ```

4. **Gate**: All DTO snapshot tests must pass before proceeding to Phase 1.0.1.

### 1.0.1 Eliminate `as any` Casts That Bypass DTO Schemas

Now that Zod schemas define the canonical types, sweep the codebase and replace every `as any[]` / `as any` / `as Record<string, any>` cast on DTO-typed data with the actual Zod-inferred type. Known locations:

| Cast | File | Line(s) | Replacement |
|------|------|---------|-------------|
| `finding.answeredQuestions as any[]` | `steps/finalize.ts` | 105, 116, 138, 253-254 | `finding.answeredQuestions as IAnsweredQuestion[]` (or remove cast entirely if type already matches) |
| `finding.answeredQuestions as any[]` | `review/kv.ts` | 513 | Same |
| `(oldFinding as Record<string, any>).reAuditedAt = ...` | `controller.ts` | 299 | Direct property access — `reAuditedAt` is already on `AuditFinding` at `types/mod.ts:98` |
| `(f as any).reAuditedAt` | `controller.ts` | 1441 | Same |
| `finding as Record<string, any>` | `controller.ts` | 36, 104, 193+ | Use `AuditFinding` type |
| `(finding as Record<string, any>).appealSourceFindingId` | `steps/finalize.ts` | 41 | Add `appealSourceFindingId` to DTO if missing, then use typed access |

**Why this matters**: The DTO schemas are only protective if code actually uses the inferred types. Casts to `any` create a shadow type system that the compiler and Zod cannot validate. Phase 1 behavioral tests written AFTER this sweep will exercise the typed path, catching regressions that `any` would hide.

**Procedure**: For each cast, check whether the accessed field exists on the DTO schema. If yes, remove the cast. If no (the field is genuinely absent from the schema), add it to the DTO with `.optional()` and update the snapshot test — this is a deliberate DTO change, not an accidental one.

**Gate**: `grep -rn "as any" --include="*.ts"` should return zero hits on DTO-typed variables. Casts on non-DTO data (e.g., third-party library interop) are acceptable.

**Estimated: ~10 DTO files, ~30 snapshot tests**

### 1.1 Unit Tests — Pure Business Logic

These functions have NO external dependencies and can be tested immediately:

| Function              | File                            | What It Does                            | Test Type       |
| --------------------- | ------------------------------- | --------------------------------------- | --------------- |
| `createFinding`       | `types/mod.ts:101`              | Factory for AuditFinding                | Unit            |
| `createJob`           | `types/mod.ts:145`              | Factory for AuditJob                    | Unit            |
| `pickRecords`         | `types/mod.ts:162`              | Filter eligible records from job        | Unit            |
| `markAuditDone`       | `types/mod.ts:170`              | Mark audit complete, flip job status    | Unit            |
| `createQuestion`      | `types/mod.ts:183`              | Factory for IQuestion with defaults     | Unit            |
| `normalizeAnswer`     | `types/mod.ts:196`              | Normalize LLM answer to Yes/No          | Unit            |
| `answerQuestion`      | `types/mod.ts:206`              | Combine question + LLM answer           | Unit            |
| `populateQuestions`   | `providers/question-expr.ts:15` | Template replacement with record fields | Unit            |
| `parseAst`            | `providers/question-expr.ts:37` | Parse compound question AST             | Unit            |
| `pullNotes`           | `providers/question-expr.ts:58` | Extract backtick-fenced notes           | Unit            |
| `orgKey`              | `lib/org.ts:5`                  | Build org-scoped KV key                 | Unit            |
| `chunkText`           | `providers/pinecone.ts:44`      | Semantic text chunking                  | Unit            |
| `makeUserPrompt`      | `providers/groq.ts:77`          | Build LLM prompt string                 | Unit            |
| `parseLlmJson`        | `providers/groq.ts:219`         | Parse JSON from LLM response            | Unit            |
| `identifyRoles`       | `providers/assemblyai.ts:171`   | Label speakers by talk duration         | Unit            |
| `strToBool`           | `steps/ask-batch.ts:17`         | Convert string to boolean               | Unit            |
| `Combometer`          | `shared/combometer.ts`          | Combo timer state machine               | Unit            |
| `checkBadges`         | `shared/badges.ts`              | Badge eligibility checker               | Unit            |
| `rarityFromPrice`     | `shared/badges.ts`              | Price-to-rarity mapping                 | Unit            |
| `STORE_CATALOG`       | `shared/badges.ts`              | Store item definitions                  | Unit (snapshot) |
| `DEFAULT_BADGE_STATS` | `shared/badges.ts`              | Default stats shape                     | Unit (snapshot) |

**Estimated: ~21 test files, ~80 test cases**

### 1.2 Integration Tests — Coordinator/Handler Logic

These touch Deno KV or compose multiple operations. Mock KV and external fetches.

| Function Group                                             | File                       | Dependencies              | Test Type   |
| ---------------------------------------------------------- | -------------------------- | ------------------------- | ----------- |
| `ChunkedKv` (set/get/delete)                               | `lib/kv.ts:17-66`          | Deno KV                   | Integration |
| `saveFinding` / `getFinding`                               | `lib/kv.ts:74-82`          | Deno KV via ChunkedKv     | Integration |
| `saveJob` / `getJob`                                       | `lib/kv.ts:84-95`          | Deno KV                   | Integration |
| `cacheAnswer` / `getCachedAnswer`                          | `lib/kv.ts:99+`            | Deno KV                   | Integration |
| `trackActive` / `trackCompleted` / `trackError`            | `lib/kv.ts`                | Deno KV                   | Integration |
| `fireWebhook`                                              | `lib/kv.ts`                | Deno KV + fetch           | Integration |
| `authenticate` / `resolveEffectiveAuth`                    | `auth/kv.ts`               | Deno KV + cookies         | Integration |
| `createOrg` / `createUser` / `verifyUser`                  | `auth/kv.ts`               | Deno KV                   | Integration |
| `populateReviewQueue` / `claimNextItem` / `recordDecision` | `review/kv.ts`             | Deno KV                   | Integration |
| `populateJudgeQueue` / `claimNextItem` / `recordDecision`  | `judge/kv.ts`              | Deno KV                   | Integration |
| `serveConfig`                                              | `question-lab/kv.ts`       | Deno KV                   | Integration |
| `enqueueStep` / `enqueueCleanup`                           | `lib/queue.ts`             | fetch (QStash/local)      | Integration |
| `stepInit`                                                 | `steps/init.ts`            | KV + S3 + Genie           | Integration |
| `stepTranscribe`                                           | `steps/transcribe.ts`      | KV + S3 + AssemblyAI      | Integration |
| `stepTranscribeCb`                                         | `steps/transcribe-cb.ts`   | KV + Groq                 | Integration |
| `stepPrepare`                                              | `steps/prepare.ts`         | KV + QuickBase + Pinecone | Integration |
| `stepAskBatch`                                             | `steps/ask-batch.ts`       | KV + Groq + Pinecone      | Integration |
| `stepFinalize`                                             | `steps/finalize.ts`        | KV + Groq + webhooks      | Integration |
| `stepCleanup`                                              | `steps/cleanup.ts`         | Pinecone                  | Integration |
| `handleAuditByRid` / `handlePackageByRid`                  | `controller.ts`            | KV + QuickBase            | Integration |
| Review handlers                                            | `review/handlers.ts`       | Auth + KV                 | Integration |
| Judge handlers                                             | `judge/handlers.ts`        | Auth + KV                 | Integration |
| Manager handlers                                           | `manager/handlers.ts`      | Auth + KV                 | Integration |
| Agent handlers                                             | `agent/handlers.ts`        | Auth + KV                 | Integration |
| Question Lab handlers                                      | `question-lab/handlers.ts` | Auth + KV                 | Integration |
| Route dispatch (main.ts POST/GET routes)                   | `main.ts:198-382`          | Everything                | Integration |

**Estimated: ~26 test files, ~150 test cases**

### 1.3 Smoke Tests — External Service Connectivity

These verify that provider modules can actually reach their APIs. Run against real services in CI with secrets.

| Provider                               | File                      | External Service  |
| -------------------------------------- | ------------------------- | ----------------- |
| `S3Ref.save` / `S3Ref.get`             | `lib/s3.ts`               | AWS S3            |
| `queryRecords` / `getDateLegByRid`     | `providers/quickbase.ts`  | QuickBase API     |
| `transcribe`                           | `providers/assemblyai.ts` | AssemblyAI        |
| `askQuestion` / `diarize`              | `providers/groq.ts`       | Groq API          |
| `upload` / `query` / `deleteNamespace` | `providers/pinecone.ts`   | Pinecone + OpenAI |
| `downloadRecording`                    | `providers/genie.ts`      | Genie API         |
| `sendEmail`                            | `providers/postmark.ts`   | Postmark          |

**Estimated: 7 smoke test files, ~20 test cases**

### 1.4 E2E Tests — Playwright

Full user journey tests against a running server:

| Flow             | What It Tests                                       |
| ---------------- | --------------------------------------------------- |
| Register + Login | Auth flow, session cookies, role redirect           |
| Admin Dashboard  | Login as admin, see pipeline stats, manage users    |
| Trigger Audit    | POST /audit/test-by-rid, poll for completion        |
| Review Queue     | Login as reviewer, claim item, decide, verify stats |
| Judge Panel      | Login as judge, claim appeal, decide, verify stats  |
| Manager Portal   | Login as manager, view queue, remediate             |
| Agent Dashboard  | Login as agent, view audit results, buy store item  |
| Question Lab     | Create config, test questions, use in audit         |
| Gamification     | Sound packs, badges, combos, streaks                |

**Estimated: 9 spec files, ~30 test cases**

---

## Phase 2: Structural Refactor (With Tests as Safety Net)

After Phase 1 provides coverage, move code into the target directory structure. Every move is validated by re-running the test that covers it.

**Note**: The `src/` tree below lives under `backend/` in the final mono-repo layout (see Phase 4, Section 4.1). During Phase 2, code moves into `backend/src/`. Phase 4 adds `frontend/` alongside it.

### 2.1 Target Directory Structure

```
autobottom/backend/
├── src/
│   ├── bootstrap.ts                        # App wiring, exports
│   ├── domain/
│   │   ├── business/
│   │   │   ├── audit-job/
│   │   │   │   ├── mod.ts                  # createJob, pickRecords, markAuditDone
│   │   │   │   └── test.ts
│   │   │   ├── audit-finding/
│   │   │   │   ├── mod.ts                  # createFinding, normalizeAnswer, answerQuestion
│   │   │   │   └── test.ts
│   │   │   ├── question-expr/
│   │   │   │   ├── mod.ts                  # populateQuestions, parseAst, pullNotes
│   │   │   │   └── test.ts
│   │   │   ├── question/
│   │   │   │   ├── mod.ts                  # createQuestion
│   │   │   │   └── test.ts
│   │   │   ├── gamification/
│   │   │   │   ├── badges/
│   │   │   │   │   ├── mod.ts              # checkBadges, STORE_CATALOG, rarityFromPrice
│   │   │   │   │   └── test.ts
│   │   │   │   └── combometer/
│   │   │   │       ├── mod.ts              # Combometer class
│   │   │   │       └── test.ts
│   │   │   └── text-processing/
│   │   │       ├── mod.ts                  # chunkText, parseLlmJson, makeUserPrompt
│   │   │       └── test.ts
│   │   │
│   │   ├── data/
│   │   │   ├── kv/
│   │   │   │   ├── mod.ts                  # ChunkedKv, finding CRUD, job CRUD, cache, stats, events, messaging
│   │   │   │   └── smk.test.ts
│   │   │   ├── s3/
│   │   │   │   ├── mod.ts                  # S3Ref
│   │   │   │   └── smk.test.ts
│   │   │   ├── groq/
│   │   │   │   ├── mod.ts                  # askQuestion, generateFeedback, summarize, diarize
│   │   │   │   └── smk.test.ts
│   │   │   ├── assemblyai/
│   │   │   │   ├── mod.ts                  # transcribe, transcribeWithUtterances, identifyRoles
│   │   │   │   └── smk.test.ts
│   │   │   ├── pinecone/
│   │   │   │   ├── mod.ts                  # upload, query, deleteNamespace
│   │   │   │   └── smk.test.ts
│   │   │   ├── quickbase/
│   │   │   │   ├── mod.ts                  # queryRecords, getDateLegByRid, getQuestionsForDestination
│   │   │   │   └── smk.test.ts
│   │   │   ├── genie/
│   │   │   │   ├── mod.ts                  # downloadRecording, getRecordingUrl
│   │   │   │   └── smk.test.ts
│   │   │   ├── postmark/
│   │   │   │   ├── mod.ts                  # sendEmail
│   │   │   │   └── smk.test.ts
│   │   │   └── queue/
│   │   │       ├── mod.ts                  # enqueueStep, enqueueCleanup
│   │   │       └── smk.test.ts
│   │   │
│   │   └── coordinators/
│   │       ├── pipeline/
│   │       │   ├── init/
│   │       │   │   ├── mod.ts              # stepInit
│   │       │   │   └── int.test.ts
│   │       │   ├── transcribe/
│   │       │   │   ├── mod.ts              # stepTranscribe
│   │       │   │   └── int.test.ts
│   │       │   ├── diarize/
│   │       │   │   ├── mod.ts              # stepTranscribeCb
│   │       │   │   └── int.test.ts
│   │       │   ├── prepare/
│   │       │   │   ├── mod.ts              # stepPrepare
│   │       │   │   └── int.test.ts
│   │       │   ├── ask-batch/
│   │       │   │   ├── mod.ts              # stepAskBatch + askLlmOne
│   │       │   │   └── int.test.ts
│   │       │   ├── finalize/
│   │       │   │   ├── mod.ts              # stepFinalize (split: badge logic → business)
│   │       │   │   └── int.test.ts
│   │       │   └── cleanup/
│   │       │       ├── mod.ts              # stepCleanup
│   │       │       └── int.test.ts
│   │       ├── auth/
│   │       │   ├── mod.ts                  # login, register, logout, impersonate
│   │       │   └── int.test.ts
│   │       ├── review/
│   │       │   ├── mod.ts                  # claimNextItem, recordDecision, backfill
│   │       │   └── int.test.ts
│   │       ├── judge/
│   │       │   ├── mod.ts                  # judge queue, appeals
│   │       │   └── int.test.ts
│   │       ├── manager/
│   │       │   ├── mod.ts                  # remediation, agent management
│   │       │   └── int.test.ts
│   │       ├── agent/
│   │       │   ├── mod.ts                  # dashboard data, game state, store
│   │       │   └── int.test.ts
│   │       └── question-lab/
│   │           ├── mod.ts                  # config CRUD, serve config
│   │           └── int.test.ts
│   │
│   └── entrypoints/
│       ├── api.ts                          # POST routes for pipeline, audit, admin, messaging
│       ├── pages.ts                        # GET routes for HTML pages
│       ├── auth.ts                         # Login/register/logout routes
│       ├── review.ts                       # Review API + page routes
│       ├── judge.ts                        # Judge API + page routes
│       ├── manager.ts                      # Manager API + page routes
│       ├── agent.ts                        # Agent API + page routes
│       ├── admin.ts                        # Admin API + page routes
│       ├── question-lab.ts                 # Question Lab routes
│       └── gamification.ts                 # Gamification + store + badges routes
│
├── dto/
│   ├── audit-finding.ts                    # AuditFinding Zod schema + inferred type
│   ├── audit-job.ts                        # AuditJob Zod schema + inferred type
│   ├── question.ts                         # IQuestion, IQuestionSeed, IAnsweredQuestion Zod schemas
│   ├── feedback.ts                         # FeedbackCardData Zod schema
│   ├── auth.ts                             # AuthContext, LoginDto, RegisterDto Zod schemas
│   ├── gamification.ts                     # BadgeDef, EarnedBadge, ComboConfig, BadgeCheckState Zod schemas
│   ├── webhook.ts                          # WebhookConfig Zod schema
│   └── store.ts                            # StoreItem Zod schema
│
├── e2e/
│   ├── playwright.config.ts
│   ├── fixtures/
│   │   └── auth.ts                         # Login/seed helpers
│   └── specs/
│       ├── auth.spec.ts
│       ├── admin-dashboard.spec.ts
│       ├── audit-pipeline.spec.ts
│       ├── review-queue.spec.ts
│       ├── judge-panel.spec.ts
│       ├── manager-portal.spec.ts
│       ├── agent-dashboard.spec.ts
│       ├── question-lab.spec.ts
│       └── gamification.spec.ts
│
├── shared/                                 # Static assets + page templates (stays as-is until Fresh migration)
│   ├── icons.ts
│   ├── sound-engine.ts
│   └── ... (page templates)
│
├── deno.json
├── .env
├── .gitignore
└── seed-data.json
```

### 2.2 Move Order (Vertical Slices)

Each slice moves ONE feature end-to-end (business → data → coordinator → entrypoint → DTO). Never do all DTOs, then all business, etc.

| Slice        | What Moves                                                                                         | Dependencies                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Slice 0**  | `deno.json`, test infrastructure, shared helpers (`json()` de-dup), `env.ts`, `lib/org.ts`         | None                                                                                  |
| **Slice 1**  | `types/mod.ts` → `dto/*` + `src/domain/business/audit-job/` + `src/domain/business/audit-finding/` | Slice 0                                                                               |
| **Slice 2**  | `providers/question-expr.ts` → `src/domain/business/question-expr/`                                | Slice 1                                                                               |
| **Slice 3**  | `shared/badges.ts` + `shared/combometer.ts` → `src/domain/business/gamification/`                  | Slice 0                                                                               |
| **Slice 4**  | `lib/kv.ts` → `src/domain/data/kv/` **(HIGHEST-RISK SLICE — see Rule 8 and Rule 9 below)** | Slice 0                                                                               |
| **Slice 5**  | `lib/s3.ts` → `src/domain/data/s3/`                                                                | Slice 0                                                                               |
| **Slice 6**  | `lib/queue.ts` → `src/domain/data/queue/`                                                          | Slice 0                                                                               |
| **Slice 7**  | `providers/groq.ts` → `src/domain/data/groq/` + `src/domain/business/text-processing/`             | Slice 0                                                                               |
| **Slice 8**  | `providers/assemblyai.ts` → `src/domain/data/assemblyai/`                                          | Slice 0                                                                               |
| **Slice 9**  | `providers/pinecone.ts` → `src/domain/data/pinecone/`                                              | Slice 0                                                                               |
| **Slice 10** | `providers/quickbase.ts` → `src/domain/data/quickbase/`                                            | Slice 0                                                                               |
| **Slice 11** | `providers/genie.ts` → `src/domain/data/genie/`                                                    | Slice 0                                                                               |
| **Slice 12** | `providers/postmark.ts` → `src/domain/data/postmark/`                                              | Slice 0                                                                               |
| **Slice 13** | `auth/kv.ts` → `src/domain/coordinators/auth/`                                                     | Slice 4                                                                               |
| **Slice 14** | `manager/*` → `src/domain/coordinators/manager/` + `src/entrypoints/manager.ts`                    | Slices 4, 13                                                                          |
| **Slice 15** | `review/*` → `src/domain/coordinators/review/` + `src/entrypoints/review.ts`                       | Slices 4, 13, **14** (review/kv.ts imports `populateManagerQueue` from manager/kv.ts) |
| **Slice 16** | `judge/*` → `src/domain/coordinators/judge/` + `src/entrypoints/judge.ts`                          | Slices 4, 13                                                                          |
| **Slice 17** | `steps/*` → `src/domain/coordinators/pipeline/*`                                                   | Slices 1-12, **15, 16** (`finalize.ts` imports from `review/kv.ts` and `judge/kv.ts`) |
| **Slice 18** | `agent/*` → `src/domain/coordinators/agent/` + `src/entrypoints/agent.ts`                          | Slices 4, 13                                                                          |
| **Slice 19** | `question-lab/*` → `src/domain/coordinators/question-lab/` + `src/entrypoints/question-lab.ts`     | Slices 4, 13                                                                          |
| **Slice 20** | `controller.ts` → `src/entrypoints/api.ts`                                                         | Slices 1, 4, 5, 6, 10, 11, **16** (`controller.ts:9` imports `populateJudgeQueue`, `saveAppeal`, `getAppeal` from `judge/kv.ts`) |
| **Slice 21** | `main.ts` → `src/entrypoints/*` + `src/bootstrap.ts`                                               | All previous slices                                                                   |
| **Slice 22** | Playwright E2E setup + all spec files                                                              | All previous slices                                                                   |

### 2.3 Key Refactoring Rules

1. **Functions → Classes (see Safety Invariant S2 for full procedure)**: Every module must export a class, not standalone functions. Migration is test-first and atomic per module: Phase 1 tests lock in behavior, Phase 0.3 `kv-factory.ts` eliminates private singletons, then each slice converts to a class with constructor-injected dependencies while preserving old function exports as wrappers until all callers migrate. Example: `providers/groq.ts` standalone functions → `class GroqProvider { constructor(private kv: Deno.Kv) {} askQuestion(), generateFeedback(), ... }` with `export async function askQuestion(...) { return new GroqProvider(await kvFactory()).askQuestion(...) }` as the compatibility wrapper

2. **Extract pure logic from coordinators**: `steps/finalize.ts` currently mixes badge XP calculation (pure math), KV writes (data), and webhook dispatch (data). The XP calculation moves to `business/gamification/`, the rest stays as coordinator.

3. **DTOs get runtime validation via Zod**: Replace plain interfaces with Zod schemas that infer TypeScript types. Zod is Deno-native (no decorator metadata, no `reflect-metadata` polyfill needed). The DTO boundary is where external input enters the system. **NOT `class-validator`** — that requires legacy TypeScript decorators and `reflect-metadata`, which are not native to Deno.

4. **De-duplicate `json()` helper**: One shared utility, imported everywhere.

5. **Entrypoints are thin**: Route handlers in `src/entrypoints/` only parse request, call coordinator, return response. No business logic.

6. **Break cross-coordinator imports (see Safety Invariant S4 for classification rules)**: Currently `steps/finalize.ts` → `review/kv.ts` → `manager/kv.ts` — one coordinator calling another. Fix by decomposing the `populate*` functions into proper layers:

   **Current state** (violations):
   - `populateReviewQueue` (`review/kv.ts:57-86`): filters `answer === "No"` (business) + atomic KV writes (data) in one function
   - `populateManagerQueue` (`manager/kv.ts:52-93`): reads review-decided entries (data) + filters confirmed failures (business) + builds queue item shape (business) + writes to KV (data) — a coordinator disguised as a data function
   - `populateJudgeQueue` (`judge/kv.ts:63-93`): builds JudgeItem shapes (business) + atomic KV writes (data)

   **Target decomposition**:
   - `src/domain/business/queue-routing/mod.ts` — pure functions: `selectItemsForReview(questions)` returns items where answer is "No"; `selectItemsForJudge(questions)` returns all items; `buildManagerQueueItem(finding, confirmedFailures)` builds the ManagerQueueItem shape. Imports from `dto/` only.
   - `src/domain/data/kv/mod.ts` — IO operations: `writeReviewQueueItems(orgId, findingId, items)`, `writeJudgeQueueItems(orgId, findingId, items)`, `writeManagerQueueItem(orgId, item)`, `readReviewDecisions(orgId, findingId)`. Accepts and returns DTO types only.
   - Coordinators (`pipeline/finalize/`, `review/`, `manager/`) orchestrate: read data → call business → write data.

   **Before moving**: Write characterization tests for each `populate*` function that capture exact KV key/value pairs for known inputs. Write a test for the `recordDecision → populateManagerQueue` chain (`review/kv.ts:214-222`). Run before AND after decomposition to confirm identical KV state.

   **Failure-path characterization**: `populateManagerQueue` is called as a fire-and-forget at `review/kv.ts:219` — it runs AFTER the atomic commit at line 204, with `.catch((err) => ...)` that only logs. This means: if `populateManagerQueue` throws, the review decision is recorded but the manager queue item is silently never created. Confirmed failures disappear from the remediation queue. Write a characterization test that **mocks `populateManagerQueue` to throw** and asserts:
   - The review decision KV write still succeeds (atomic commit at line 204 is independent)
   - The error is caught and logged (not bubbled to the caller)
   - No manager queue item exists

   This test locks in the current fire-and-forget behavior. After decomposition into coordinator sandwich, the new coordinator must preserve this isolation — a failure in manager queue population must NOT roll back the review decision. If the refactor changes this behavior (e.g., by putting both writes in the same coordinator try/catch), this test will catch it.

8. **Collapse `lib/kv.ts` to a re-export shim immediately after Slice 4**: `lib/kv.ts` has 20+ importers across every domain. The S2 wrapper strategy keeps old function names alive, but during the transition (Slices 4-21) two import paths coexist: `../lib/kv.ts` (wrapper that instantiates the class per-call) and the new `../src/domain/data/kv/mod.ts` (class directly). If any module accidentally imports both — one via wrapper, one directly — two separate class instances are created per request. Even with `kv-factory.ts` ensuring a single KV *connection*, class-level state (caches, transaction context) diverges. **Fix**: After Slice 4 completes, immediately replace `lib/kv.ts` with a pure re-export shim: `export * from "../backend/src/domain/data/kv/mod.ts"`. This collapses both paths into one code path. The wrappers (old function names delegating to the class) live inside the new `kv/mod.ts`, not in the shim. Delete the shim only after Slice 21 when `main.ts` is decomposed and all imports point to the new path.

9. **Shim completeness test — MANDATORY after Slice 4**: `lib/kv.ts` exports 65 async functions and 20+ type definitions. It is imported by 16 files across every domain. The re-export shim (Rule 8) must forward ALL named exports — one missed export silently becomes `undefined` at runtime. Server boot does NOT exercise all 65 functions, so a missing export will not be caught until the specific code path runs (possibly in production).

   **After Slice 4 completes**, write and run this test:
   ```ts
   Deno.test("lib/kv.ts shim re-exports all named exports from new location", async () => {
     const shimExports = await import("../../lib/kv.ts");
     const realExports = await import("../../backend/src/domain/data/kv/mod.ts");
     const shimKeys = Object.keys(shimExports).sort();
     const realKeys = Object.keys(realExports).sort();
     assertEquals(shimKeys, realKeys, "Shim is missing exports: " +
       realKeys.filter(k => !shimKeys.includes(k)).join(", "));
     // Verify no export is undefined
     for (const key of shimKeys) {
       assertNotEquals(shimExports[key], undefined, `Export '${key}' is undefined through shim`);
     }
   });
   ```
   Run this test at every subsequent slice gate until the shim is deleted in Slice 21. Apply the same pattern to the `shared/badges.ts` shim (Rule 7).

7. **Re-export `shared/badges.ts` from new location**: When `shared/badges.ts` moves to `src/domain/business/gamification/badges/mod.ts` (Slice 3), page templates (`manager/page.ts`, `agent/page.ts`, etc.) still import from `shared/badges.ts`. Add a re-export shim at the old path: `export * from "../src/domain/business/gamification/badges/mod.ts"`. Remove the shim when page templates migrate to Fresh.

---

## Phase 3: Remaining Cleanup

### 3.1 Delete Dead Files

| File                          | Reason                                                                                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kv.ts` (root)                | 0 lines, empty file                                                                                                                                               |
| `test-qlab.ts`                | Ad-hoc script, replaced by structured tests                                                                                                                       |
| `test-single.ts`              | Ad-hoc script, replaced by structured tests                                                                                                                       |
| `serve.ts`                    | Separate dev server, superseded by `main.ts`                                                                                                                      |
| `sounds-backup-v1.js`         | Backup file                                                                                                                                                       |
| `proto/` directory            | Prototype code, screenshots                                                                                                                                       |
| `*.png` files at root         | 30+ screenshot files cluttering the repo                                                                                                                          |
| `*.md` docs at root           | Move relevant ones to `docs/`, delete the rest                                                                                                                    |
| `instrument/` directory       | Standalone Question Lab prototype (632-line `backend.ts` + 585-line `index.html`). Superseded by `question-lab/`. Delete after verifying no unique logic remains. |
| `expr-builder-demo.html`      | 1,055-line standalone expression builder demo. Prototype artifact.                                                                                                |
| `shared/combometer-test.html` | 416-line standalone combometer test page. Replaced by unit tests for `Combometer` class.                                                                          |
| `study/` directory            | Research docs + `data-model-overview.html` (2,736 lines). Move to `docs/` or delete.                                                                              |

### 3.2 Files That Move but Were Not Mentioned in Phase 2 Slices

| File                  | Lines | Destination                                                          | Notes                                                                                                                                                                                                           |
| --------------------- | ----- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `swagger.ts`          | 244   | `backend/src/entrypoints/docs.ts`                                    | OpenAPI spec + Swagger HTML generator. Moves with Slice 20 (controller/entrypoints). Needs tests: spec object shape, HTML output.                                                                               |
| `seed-local.ts`       | 120   | `backend/scripts/seed-local.ts`                                      | Dev seeding script (creates test org, users, review queue items). Not domain code — goes in a `scripts/` directory. No unit test needed (it's a script), but should be referenced in a `deno task seed` config. |
| `review/seed-test.ts` | 107   | `backend/scripts/seed-review.ts`                                     | Review queue test seeding. Same treatment as `seed-local.ts`.                                                                                                                                                   |
| `agent/kv.ts`         | 133   | `backend/src/domain/data/kv/agent.ts` (or merged into `kv/mod.ts`)   | Agent-specific KV operations. Covered by Slice 18 (agent coordinator) but not called out explicitly.                                                                                                            |
| `manager/kv.ts`       | 417   | `backend/src/domain/data/kv/manager.ts` (or merged into `kv/mod.ts`) | Manager-specific KV operations. Covered by Slice 14 (manager coordinator) but not called out explicitly.                                                                                                        |

### 3.3 Page Templates

The page files (`dashboard/page.ts`, `manager/page.ts`, etc.) are massive HTML template literals. They are replaced by Fresh 2+ routes in Phase 4 and deleted in slice F17.

### 3.3 Reconcile with `autobottom.rune`

`autobottom.rune` (2,327 lines) is a structured specification describing the **target architecture** — it defines ~60+ request handlers, DTOs, call chains, and error cases for features that do NOT yet exist in the code:

- Team management (`createTeam`, `updateTeam`, `addTeamMember`)
- Role management (`createRole`, `updateRole`)
- Coaching (`queueCoaching`, `addressCoaching`)
- Dashboard builder (`createDashboard`, `cloneDashboard`)
- Reports (`createReport`, `runReport`)
- Provider resolution (`resolveProvider`, `executeWithFallback`)

The rune file is the **north star** for what the system should become. This refactor reorganizes existing code to match the rune's architectural patterns (`auth::`, `db:`, `mq:`, `ex:` prefixes map to our business/data/coordinator/entrypoint layers). After Phase 2, the directory structure will be ready to receive the unimplemented rune features via normal TDD vertical slices.

**Action**: After Phase 2 completes, audit the rune file against the refactored code and create a gap analysis for unimplemented features.

---

## Phase 4: Frontend — Fresh 2+ Rewrite

### 4.0 What Exists Now

The entire frontend is **raw HTML template literal strings** returned by TypeScript functions. There is no component model, no hydration, no build pipeline, no CSS extraction. Every page is a single monolithic string of HTML + inline `<style>` + inline `<script>`.

**Frontend file inventory (9,805 lines total):**

| File                          | Lines | What It Renders                                            |
| ----------------------------- | ----- | ---------------------------------------------------------- |
| `shared/queue-page.ts`        | 2,227 | Review + Judge queue UI (parameterized by mode)            |
| `dashboard/page.ts`           | 1,555 | Admin dashboard (stats, config, user management)           |
| `manager/page.ts`             | 1,544 | Manager portal (failure queue, agent management)           |
| `chat/page.ts`                | 1,044 | Real-time chat UI                                          |
| `agent/page.ts`               | 791   | Agent dashboard (audit results, trends, store)             |
| `shared/gamification-page.ts` | 679   | Gamification settings (streaks, combos, sound packs)       |
| `shared/badge-editor-page.ts` | 642   | Admin badge/store catalog editor                           |
| `judge/dashboard.ts`          | 605   | Judge analytics dashboard                                  |
| `shared/store-ui.ts`          | 472   | Store CSS + JS (shared between store-page and agent)       |
| `review/dashboard.ts`         | 443   | Reviewer analytics dashboard                               |
| `question-lab/page.ts`        | 333   | Question Lab CRUD + testing UI                             |
| `shared/super-admin-page.ts`  | 297   | Super admin org management                                 |
| `shared/sound-engine.ts`      | 276   | Client-side sound engine (served as `/js/sound-engine.js`) |
| `shared/icons.ts`             | 234   | SVG icon library                                           |
| `auth/page.ts`                | 188   | Login + register forms                                     |
| `shared/store-page.ts`        | 104   | Standalone store page shell                                |
| `shared/impersonate-bar.ts`   | 79    | Admin impersonation bar snippet                            |
| `review/page.ts`              | 7     | Thin wrapper → `shared/queue-page.ts`                      |
| `judge/page.ts`               | 7     | Thin wrapper → `shared/queue-page.ts`                      |

**Current patterns** (citations from reading the files):

- `dashboard/page.ts:4` — `getDashboardPage()` returns a single template literal string
- `auth/page.ts:34` — inline `<form onsubmit="return handleRegister(event)">` with `<script>` for client JS
- `shared/queue-page.ts:14` — `generateQueuePage(mode: "review" | "judge")` parameterized HTML generation
- `chat/page.ts:42-79` — elaborate CSS avatar frame system with 8 animation variants
- `manager/page.ts:3` — imports `getPrefabEventsJson()` from `shared/badges.ts`, interpolates into HTML
- All pages share the same dark theme CSS variables but duplicate them independently
- Client-side JS uses raw `fetch()` against `/review/api/*`, `/judge/api/*`, etc.

### 4.1 Mono-Repo Structure

Backend and frontend live in the same repo but as separate packages. The backend has no Preact/Fresh dependency. The frontend has no business logic.

```
autobottom/
├── backend/                                # Phase 2 output lives here
│   ├── src/
│   │   ├── bootstrap.ts
│   │   ├── domain/
│   │   │   ├── business/
│   │   │   ├── data/
│   │   │   └── coordinators/
│   │   └── entrypoints/                    # API-only routes (JSON responses)
│   ├── dto/
│   ├── deno.json                           # Backend config (test, lint, fmt)
│   └── main.ts                             # Starts HTTP server, exports handler for Fresh
│
├── frontend/                               # Fresh 2+ app
│   ├── assets/
│   │   └── styles/
│   │       ├── theme.css                   # Shared dark theme variables (extracted from duplicated :root blocks)
│   │       ├── layout.css                  # Sidebar, .layout, .main
│   │       ├── components.css              # Stat cards, tables, badges, buttons, forms
│   │       └── animations.css              # Avatar frames, combometer, confetti
│   ├── components/                         # Server-only Preact components
│   │   ├── Sidebar.tsx                     # Shared sidebar (parameterized by role/accent)
│   │   ├── StatCard.tsx
│   │   ├── StatRow.tsx
│   │   ├── DataTable.tsx
│   │   ├── Badge.tsx
│   │   ├── Avatar.tsx                      # Avatar with frame system (bronze → legendary)
│   │   ├── TopBar.tsx
│   │   ├── SectionHead.tsx
│   │   └── EmptyState.tsx
│   ├── islands/                            # Client-hydrated interactive components
│   │   ├── ReviewQueue.tsx                 # Claim/decide/back, hotkeys, combo, sound
│   │   ├── JudgeQueue.tsx                  # Uphold/overturn, hotkeys, combo, sound
│   │   ├── AuditTrigger.tsx                # Admin: trigger audit by RID
│   │   ├── UserManager.tsx                 # Admin: add/remove users
│   │   ├── PipelineConfig.tsx              # Admin: parallelism, settings
│   │   ├── QuestionLabEditor.tsx           # Create/edit/test question configs
│   │   ├── ChatRoom.tsx                    # Real-time messaging with SSE
│   │   ├── ManagerQueue.tsx                # Failure remediation queue
│   │   ├── AgentDashboard.tsx              # Audit results, trends, score history
│   │   ├── StoreView.tsx                   # Store catalog, buy items, equip
│   │   ├── SoundPackEditor.tsx             # Upload sounds, preview, manage packs
│   │   ├── BadgeEditor.tsx                 # Admin: edit store catalog
│   │   ├── GamificationSettings.tsx        # Combo/streak/XP config
│   │   ├── Combometer.tsx                  # Combo timer bar + counter display
│   │   ├── LoginForm.tsx                   # Email/password form with fetch
│   │   ├── RegisterForm.tsx                # Org name + email + password form
│   │   ├── SuperAdminPanel.tsx             # Org CRUD, user management
│   │   └── ImpersonateBar.tsx              # Admin impersonation control
│   ├── routes/
│   │   ├── _app.tsx                        # App wrapper: <html>, <head>, theme CSS
│   │   ├── _layout.tsx                     # Base layout (optional sidebar per role)
│   │   ├── _middleware.ts                  # Auth middleware: parse session, set ctx.state
│   │   ├── _error.tsx                      # Error page
│   │   ├── index.tsx                       # Landing page (current handleDemoPage)
│   │   ├── login.tsx                       # Login page
│   │   ├── register.tsx                    # Register page
│   │   ├── store.tsx                       # /store (all roles)
│   │   ├── chat.tsx                        # /chat
│   │   ├── gamification.tsx                # /gamification
│   │   ├── admin/
│   │   │   ├── _layout.tsx                 # Admin sidebar layout
│   │   │   ├── dashboard.tsx               # /admin/dashboard
│   │   │   ├── badge-editor.tsx            # /admin/badge-editor
│   │   │   └── settings/
│   │   │       └── [category].tsx          # /admin/settings/:category
│   │   ├── review/
│   │   │   ├── _layout.tsx                 # Review sidebar layout
│   │   │   ├── index.tsx                   # /review (queue UI)
│   │   │   └── dashboard.tsx               # /review/dashboard
│   │   ├── judge/
│   │   │   ├── _layout.tsx                 # Judge sidebar layout
│   │   │   ├── index.tsx                   # /judge (queue UI)
│   │   │   └── dashboard.tsx               # /judge/dashboard
│   │   ├── manager/
│   │   │   ├── _layout.tsx                 # Manager sidebar layout
│   │   │   └── index.tsx                   # /manager
│   │   ├── agent/
│   │   │   ├── _layout.tsx                 # Agent sidebar layout
│   │   │   └── index.tsx                   # /agent
│   │   ├── question-lab/
│   │   │   └── index.tsx                   # /question-lab
│   │   ├── super-admin.tsx                 # /super-admin
│   │   └── api/
│   │       └── [...path].tsx               # Catch-all proxy to backend API
│   ├── static/
│   │   ├── sounds/                         # Sound pack audio files
│   │   └── favicon.ico
│   ├── utils/
│   │   ├── define.ts                       # createDefine<AppState>
│   │   ├── api.ts                          # Typed fetch wrappers for backend API
│   │   ├── signals.ts                      # Shared Preact signals (combo state, game state)
│   │   └── sound-engine.ts                 # Client-side sound playback
│   ├── main.ts                             # Fresh server entry
│   ├── client.ts                           # Client entry (global CSS import, sound init)
│   ├── vite.config.ts
│   └── deno.json                           # Frontend config (dev, build, preview, test)
│
├── e2e/                                    # E2E tests (cover both backend + frontend)
│   ├── playwright.config.ts
│   ├── fixtures/
│   │   └── auth.ts
│   └── specs/
│       └── ...
│
└── deno.json                               # Root workspace config
```

### 4.2 Frontend-Backend Boundary

The backend exposes **JSON API routes only** (no HTML). The frontend is a Fresh 2+ app that:

1. Handles all page rendering (routes return JSX)
2. Calls the backend API for data (via `fetch` in handlers or islands)
3. Handles auth middleware (parse session cookie, redirect if needed)

**Connection**: Backend exports a `handler()` function, Fresh mounts it at `/api` via `app.mountApp("/api", backendApp)`. Single process, single port.

**Route preservation during cutover**: The `/api` prefix mount changes the URL path for all backend routes (e.g., `/audit/step/transcribe` becomes `/api/audit/step/transcribe`). This is dangerous for two reasons:

1. **In-flight QStash jobs**: `lib/queue.ts` enqueues pipeline steps with the current route paths (e.g., `${SELF_URL}/audit/step/transcribe`). Jobs in the QStash queue at deploy time will POST to the old paths. With retry delays up to 30 seconds, there is a window where queued jobs hit dead routes.

2. **External webhook callbacks**: AssemblyAI transcription callbacks (`steps/transcribe.ts`) POST to `${SELF_URL}/audit/step/transcribe-complete`. If the path changes mid-transcription, the callback fails silently.

**BLOCKER — Route aliases must exist and be tested BEFORE any other F-slice work begins.** This is not a nice-to-have mitigation — it is a production-safety invariant equivalent to S1-S5. The route cutover can break in-flight pipeline jobs (QStash retries up to 30 seconds) and external webhook callbacks (AssemblyAI transcriptions in progress). Failure mode is silent: jobs hit dead routes, no error surfaces, pipeline data is lost.

**Required implementation in F0 (scaffold)**:
1. Add backward-compatible route aliases in the Fresh `routes/api/` catch-all that forward old-path requests to the new `/api`-prefixed backend
2. **Write an integration test** that POSTs to every old pipeline path (`/audit/step/init`, `/audit/step/transcribe`, `/audit/step/transcribe-complete`, `/audit/step/prepare`, `/audit/step/ask-batch`, `/audit/step/finalize`, `/audit/step/cleanup`) and asserts they reach the backend handler (200 or expected status, not 404)
3. Keep aliases for at least one deployment cycle (or until the QStash queue is confirmed drained)
4. The `SELF_URL` env var used by `lib/queue.ts` must be updated atomically with the deploy — if it still points to old paths while the server expects new paths, the pipeline breaks
5. **Gate**: Route alias integration test must pass before F1 begins

### 4.3 Frontend Test Strategy

#### Unit Tests — Server Components (Deno.test + Preact render)

Test server-only components render correct HTML given props.

| Component   | What to Test                                                       |
| ----------- | ------------------------------------------------------------------ |
| `Sidebar`   | Renders correct links per role, highlights active, shows user info |
| `StatCard`  | Renders label, value, accent color class                           |
| `StatRow`   | Renders N cards in grid                                            |
| `DataTable` | Renders headers, rows, empty state                                 |
| `Badge`     | Renders correct tier/color CSS class                               |
| `Avatar`    | Renders frame class based on equipped item (none → legendary)      |
| `TopBar`    | Renders title, back link                                           |

**Estimated: ~7 test files, ~25 cases**

#### Unit Tests — Islands (Preact signals, state logic)

Test island state management in isolation. No browser needed — test the signal/state logic.

| Island              | What to Test                                                                   |
| ------------------- | ------------------------------------------------------------------------------ |
| `ReviewQueue`       | State transitions: empty → loaded → deciding → decided → next. Hotkey mapping. |
| `JudgeQueue`        | Same as review + overturn reason selection                                     |
| `Combometer`        | Timer logic (client-side version uses Preact signals)                          |
| `LoginForm`         | Validation: empty fields, error display, redirect on success                   |
| `RegisterForm`      | Validation: org name, email, password length                                   |
| `StoreView`         | Filter by category, buy flow, insufficient coins                               |
| `ChatRoom`          | Message list updates, SSE connection state                                     |
| `QuestionLabEditor` | Add/remove questions, save config, test run                                    |

**Estimated: ~8 test files, ~40 cases**

#### Integration Tests — Routes (Fresh `app.handler()`)

Test routes return correct status codes and rendered HTML:

| Route Group    | What to Test                                                                |
| -------------- | --------------------------------------------------------------------------- |
| Auth routes    | `/login` returns form, `/register` returns form, unauthenticated → redirect |
| Admin routes   | 302 if not admin, 200 + dashboard HTML if admin                             |
| Review routes  | 302 if not reviewer, 200 + queue UI if reviewer                             |
| Judge routes   | 302 if not judge, 200 + queue UI if judge                                   |
| Manager routes | 302 if not manager                                                          |
| Agent routes   | 302 if not user role                                                        |
| API proxy      | `/api/*` forwards to backend, returns JSON                                  |

**Estimated: ~7 test files, ~30 cases**

#### E2E Tests — Playwright (shared)

Phase 1 E2E specs (Section 1.4) point at the Fresh frontend after Phase 4. Same specs, same flows — the backend is behind the frontend now.

### 4.4 Frontend Vertical Slices

Each slice rewrites ONE page from template literal → Fresh route + components + islands. The old template page is deleted after the Fresh version passes the same E2E test.

| Slice   | What Gets Rewritten                                                                          | Creates                                                                                                        |
| ------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **F0**  | Fresh scaffold, theme CSS extraction, `_app.tsx`, `_layout.tsx`, `_middleware.ts`, API proxy | Infrastructure                                                                                                 |
| **F1**  | `auth/page.ts` → `routes/login.tsx` + `routes/register.tsx`                                  | `LoginForm`, `RegisterForm` islands                                                                            |
| **F2**  | `main.ts` handleDemoPage → `routes/index.tsx`                                                | Static page                                                                                                    |
| **F3**  | `dashboard/page.ts` → `routes/admin/dashboard.tsx`                                           | `Sidebar`, `StatCard`, `StatRow`, `TopBar` components; `PipelineConfig`, `UserManager`, `AuditTrigger` islands |
| **F4**  | `shared/queue-page.ts` (review) → `routes/review/index.tsx`                                  | `Avatar`, `Badge` components; `ReviewQueue`, `Combometer` islands                                              |
| **F5**  | `shared/queue-page.ts` (judge) → `routes/judge/index.tsx`                                    | `JudgeQueue` island (reuses F4 components)                                                                     |
| **F6**  | `review/dashboard.ts` → `routes/review/dashboard.tsx`                                        | `DataTable` component                                                                                          |
| **F7**  | `judge/dashboard.ts` → `routes/judge/dashboard.tsx`                                          | Reuses F6 components                                                                                           |
| **F8**  | `manager/page.ts` → `routes/manager/index.tsx`                                               | `SectionHead`, `EmptyState` components; `ManagerQueue` island                                                  |
| **F9**  | `agent/page.ts` → `routes/agent/index.tsx`                                                   | `AgentDashboard` island                                                                                        |
| **F10** | `chat/page.ts` → `routes/chat.tsx`                                                           | `ChatRoom` island                                                                                              |
| **F11** | `shared/store-page.ts` + `shared/store-ui.ts` → `routes/store.tsx`                           | `StoreView` island                                                                                             |
| **F12** | `shared/gamification-page.ts` → `routes/gamification.tsx`                                    | `GamificationSettings`, `SoundPackEditor` islands                                                              |
| **F13** | `question-lab/page.ts` → `routes/question-lab/index.tsx`                                     | `QuestionLabEditor` island                                                                                     |
| **F14** | `shared/badge-editor-page.ts` → `routes/admin/badge-editor.tsx`                              | `BadgeEditor` island                                                                                           |
| **F15** | `shared/super-admin-page.ts` → `routes/super-admin.tsx`                                      | `SuperAdminPanel` island                                                                                       |
| **F16** | `shared/sound-engine.ts` → `utils/sound-engine.ts`; `shared/impersonate-bar.ts` → island     | `ImpersonateBar` island                                                                                        |
| **F17** | Delete all old template literal page files, `shared/icons.ts` → component                    | Cleanup                                                                                                        |

**Dependency chain:**

```
F0 (scaffold) → F1 (auth) → F2 (landing)
                           → F3 (admin dashboard — creates shared components)
                               → F4 (review queue — creates Avatar, Badge, Combometer)
                                   → F5 (judge queue — reuses F4)
                               → F6 (review dashboard — creates DataTable)
                                   → F7 (judge dashboard — reuses F6)
                               → F8-F16 (all independent after F3, parallelizable)
                                                                    → F17 (cleanup, always last)
```

### 4.5 Key Decisions

1. **CSS extraction**: Duplicated `:root` dark theme variables across all pages → ONE `theme.css`. Sidebar layout CSS (~30 identical lines in 5 pages) → `layout.css`. Avatar frame animations (80 lines, duplicated in chat + queue-page) → `animations.css`.

2. **`shared/queue-page.ts` split**: Currently `generateQueuePage(mode)` generates different HTML per mode. In Fresh: two routes render the same base layout with different island configs (accent color, API prefix, hotkey map, decision labels). The ~2,000 lines of shared CSS/HTML become components; the ~200 lines of mode-specific logic become island props.

3. **Sound engine**: Currently served as `/js/sound-engine.js`. Migrates to `utils/sound-engine.ts` imported by islands. Uses `IS_BROWSER` guard from `fresh/runtime`.

4. **Icons**: `shared/icons.ts` (234 lines of SVG strings) → `components/Icon.tsx` returning JSX SVG elements (not template literal strings).

5. **No SPA**: App stays server-rendered with islands. Use Fresh Partials (`f-client-nav`) for sidebar navigation within a role.

6. **Inline JS → Preact signals**: All `<script>` blocks that manage state become signal-based logic inside islands. Zero raw DOM manipulation.

### 4.6 Frontend Parallel Batch Plan

#### Batch F1 (Sequential — foundation)

F0 → F1 → F2 (scaffold, auth, landing)

#### Batch F2 (Sequential — shared components)

F3 (admin dashboard creates `Sidebar`, `StatCard`, `StatRow`, `TopBar`)

#### Batch F3 (Parallel — all depend on F3 but not each other)

F4, F6, F8, F9, F10, F11, F12, F13, F14, F15, F16

#### Batch F4 (Sequential — depend on F3 results)

F5 (reuses F4 components), F7 (reuses F6 components)

#### Batch F5 (Cleanup)

F17

---

## Execution Order Summary

**Critical path (9 sequential slices)**: Phase 0 → Phase 1 → Slice 4 → 13 → 14 → 15 → 17 (fan-in) → 20 → 21. Every other slice is parallelizable around this chain. Slice 17 is not just a chain link — it is a convergence point that depends on ALL of Slices 1-16.

```
Phase 0: Infrastructure
  ├── 0.1 deno.json
  ├── 0.2 Test infrastructure (Deno.test + Playwright scaffold)
  ├── 0.3 KV + S3 dependency injection (SCOPE: 20+ call sites, not 7)
  │     ├── Category A: Replace 7 lazy singletons with kv-factory.ts import
  │     ├── Category B: Replace 9 inline Deno.openKv() calls in main.ts
  │     ├── Category C: Fix question-lab/kv.ts (add lazy cache, then swap to factory)
  │     ├── Category D: Delete 3 throwaway scripts (test-qlab.ts, test-single.ts, review/seed-test.ts)
  │     ├── lib/s3.ts: move module-level AWS credential reads into lazy getS3Client()
  │     ├── VERIFY: grep -r "Deno.openKv" returns ONLY kv-factory.ts
  │     └── VERIFY: lib/s3.ts has no module-scope Deno.env.get() calls
  ├── 0.4 .gitignore update
  ├── VALIDATE: deno task test runs (even if 0 tests). Server starts.
  └── E2E GATE: Smoke test — server starts, GET / returns 200

Phase 1: Baseline Tests (ALL tests written BEFORE any code moves)
  ├── 1.pre Characterization tests against EXISTING code (before DTOs)
  │     ├── controller.ts: handleAuditByRid, handlePackageByRid (exercises `as Record<string, any>` paths)
  │     ├── steps/finalize.ts: stepFinalize (exercises `as any[]` paths)
  │     ├── review/kv.ts: populateReviewQueue (exercises `as any[]` on answeredQuestions)
  │     └── GATE: All characterization tests pass before Phase 1.0 begins
  ├── 1.0 DTO-First — Write Zod schemas + snapshot tests (~10 files, ~30 cases)
  │     └── VALIDATE: All DTO snapshot tests pass + 1.pre characterization tests still pass
  ├── 1.0.1 Eliminate `as any` casts on DTO-typed data
  │     ├── Replace all `as any[]` / `as Record<string, any>` on findings, questions, etc.
  │     ├── VERIFY: grep -rn "as any" returns zero hits on DTO-typed variables
  │     └── VALIDATE: 1.pre characterization tests still pass (cast removal didn't change behavior)
  ├── 1.1C (badges) — MUST complete before Batch 2
  │     └── shared/badges.ts: checkBadges, rarityFromPrice, STORE_CATALOG snapshot
  ├── 1.1 remainder + 1.2 IN PARALLEL (after 1C completes):
  │     ├── 1.1 Unit tests for pure functions (~20 files, ~75 cases, excluding 1C)
  │     └── 1.2 Integration tests for KV/handler logic (~26 files, ~150 cases)
  │           ├── 2D/2E/2F safe to run — shared/badges.ts stabilized by 1C
  │           ├── Includes characterization tests for populate* functions (S4)
  │           └── Includes failure-path test: populateManagerQueue throws → review decision still committed, error caught
  ├── 1.3 Smoke tests for external providers (~7 files, ~20 cases)
  ├── 1.4 E2E — Critical paths only: login, trigger audit, complete review (3-5 specs)
  ├── VALIDATE: Full test suite (all unit + integration + DTO snapshot). ALL GREEN.
  └── E2E GATE: Phase 1 E2E specs pass

Phase 2: Backend Structural Refactor (move into backend/)
  ├── Slice 0: Infrastructure (deno.json, helpers, env)
  │     └── VALIDATE: Slice tests + dependent tests pass + server starts
  ├── Slices 1-3: Business layer (DTOs, types, gamification) — parallel
  │     └── VALIDATE per slice: Slice tests + DTO snapshots unchanged + server starts
  ├── Slices 4-12: Data layer (all providers) — parallel
  │     ├── Slice 4: HIGHEST-RISK SLICE — 65 exports, 16 importers, central data hub
  │     │     ├── After move, collapse lib/kv.ts to pure re-export shim (Rule 8)
  │     │     ├── VERIFY: Shim completeness test passes — all 65 exports resolve (Rule 9)
  │     │     └── VERIFY: main.ts dynamic imports at lines 1342, 2120 resolve via shim
  │     ├── VALIDATE per slice: Slice tests + DTO snapshots unchanged + server starts
  │     ├── DYNAMIC IMPORT CHECK per slice: grep "await import(" main.ts — update broken paths
  │     └── Each module converts to class (S2): tests pass with old function wrappers
  ├── Slice 13: Auth coordinator + server starts
  ├── Slice 14: Manager coordinator + server starts
  │     └── VERIFY: main.ts:1434 dynamic import of ./manager/kv.ts — update path or add re-export shim
  ├── Slices 15-16: Review + Judge coordinators — parallel (review depends on 14)
  │     ├── VALIDATE: Characterization tests for populate* confirm identical KV state
  │     └── VALIDATE: Failure-path test still passes (manager queue failure ≠ review rollback)
  ├── Slice 17: Pipeline steps (depends on 15, 16) ← FAN-IN CONVERGENCE POINT
  │     ├── WARNING: Slice 17 depends on ALL of Slices 1-12 AND 15 AND 16. It is the
  │     │   convergence point where errors from any prior slice compound. Treat this as
  │     │   a PHASE-LEVEL checkpoint, not a slice-level one.
  │     ├── VALIDATE: Run FULL test suite (all unit + integration + DTO snapshots) — not just slice tests
  │     ├── VALIDATE: Cross-coordinator chain tests (finalize → review/judge → manager)
  │     └── VALIDATE: Shim completeness tests (Rule 9) for lib/kv.ts and shared/badges.ts
  ├── Slices 18-19: Agent + Question Lab — parallel
  │     └── Slice 19 VERIFY: main.ts:1578 dynamic import of ./question-lab/kv.ts — update path or add re-export shim
  ├── Slice 20: Controller (depends on 1, 4, 5, 6, 10, 11, **16**) ← CORRECTED: controller.ts:9 imports from judge/kv.ts
  ├── Slice 21: main.ts decomposition — all dynamic imports resolved by now
  │     ├── WARNING: main.ts contains 78 inline function definitions (not just route wiring).
  │     │   This includes: handleForceNos (finding mutation), seedOrgData (360+ lines),
  │     │   handleEquip (game state), handleSSE (80 lines of streaming with 3 polling intervals),
  │     │   and the pipeline retry/error handler (lines 2254-2310 interleaved with Deno.serve).
  │     │   This is not a "move" — it is a behavior-preserving decomposition of 78 functions
  │     │   out of the server loop. Each extracted function needs its characterization test
  │     │   from Phase 1 to still pass.
  │     └── E2E GATE: Phase 1 E2E specs still pass after entrypoint changes
  ├── Slice 22: E2E test migration
  ├── VALIDATE: Full test suite (all unit + integration + DTO snapshot). ALL GREEN.
  └── E2E GATE: All Phase 1 E2E specs pass against restructured backend

Phase 3: Cleanup
  ├── Delete dead files, organize docs
  ├── Reconcile with autobottom.rune
  ├── VALIDATE: Full test suite. ALL GREEN.
  └── E2E GATE: Phase 1 E2E specs still pass (no regressions from cleanup)

Phase 4: Frontend — Fresh 2+ Rewrite (9,805 lines of template literals → Preact)
  ├── 4.0 Frontend baseline tests (~22 files, ~95 cases)
  │     ├── Component unit tests (~7 files, ~25 cases)
  │     ├── Island unit tests (~8 files, ~40 cases)
  │     └── Route integration tests (~7 files, ~30 cases)
  ├── Batch F1: Scaffold → Auth → Landing (F0-F2, sequential)
  │     └── F0 MUST include: backward-compatible route aliases for old paths (see 4.2 route preservation)
  │         QStash jobs + AssemblyAI callbacks will POST to old paths during cutover
  ├── Batch F2: Admin dashboard — creates shared components (F3)
  ├── Batch F3: All remaining pages — parallel (F4, F6, F8-F16)
  ├── Batch F4: Pages that reuse Batch F3 components (F5, F7)
  ├── Batch F5: Cleanup — delete old template files (F17)
  ├── VALIDATE: Full test suite (backend + frontend). ALL GREEN.
  └── E2E GATE: NEW comprehensive Fresh E2E suite (~9 specs, ~30 cases)
       Replaces Phase 1 E2E. Tests permanent architecture.

VALIDATION RULES (Safety Invariant S1):
  Per-slice:  Run moved module's tests + tests that import from changed modules
              + confirm server starts (Slice 4 onward — main.ts has no unit tests)
              + check dynamic imports: grep "await import(" main.ts (see S1 dynamic import table)
              + run shim completeness tests (Rule 9) for any active re-export shims
  Per-phase:  Run full test suite (all unit + integration + DTO snapshots)
  Slice 17:   PHASE-LEVEL checkpoint — run FULL test suite, not just slice tests (fan-in convergence)
  E2E gates:  Run E2E at phase boundaries + after entrypoint-touching slices
  DTO freeze: Snapshot tests must pass unchanged at every validation point (S3)
  Any sweep:  After Phase 1.0.1, grep confirms zero `as any` on DTO-typed vars
  Char tests: Phase 1.pre tests must pass at every Phase 1 validation point
  No skipping: You are the CI. Every gate is mandatory.
  Gate count: There are 32+ mandatory validation gates across this refactor (6 Phase 1 gates
              + 22 slice-level validations + 4+ phase-level E2E gates). Failures WILL happen.
              Budget time for gate-failure debugging. The pre-commit hook (Phase 0.2) automates
              the most common gate check (deno test) so failures surface at commit time.

TOTAL TEST INVENTORY:
  Characterization: ~3 files, ~15 cases (pre-DTO behavioral lock-in)
  DTO snapshots:    ~10 files, ~30 cases (wire type freeze)
  Backend:          ~54 files, ~280 cases (unit + integration + smoke)
  Frontend:         ~22 files, ~95 cases (component + island + route)
  E2E Phase 1-3:   3-5 specs (critical paths, minimal, throwaway)
  E2E Phase 4:     ~9 files, ~30 cases (comprehensive, permanent)
  GRAND TOTAL:     ~98+ test files, ~450+ test cases
```

---

## Parallel Batch Plan (for Phase 1 implementation)

### Batch -1 (Sequential — must complete before Batch 0)

Characterization tests against the EXISTING code, before DTOs or cast elimination. These lock in current behavior so that Phase 1.0 (Zod DTOs) and Phase 1.0.1 (`as any` removal) cannot introduce silent regressions.

| Task | Target                                                                                       |
| ---- | -------------------------------------------------------------------------------------------- |
| -1A  | `controller.ts` — characterization tests for `handleAuditByRid`, `handlePackageByRid` (exercises `as Record<string, any>` paths at lines 36, 104, 193+, 299, 1441) |
| -1B  | `steps/finalize.ts` — characterization tests for `stepFinalize` (exercises `as any[]` paths at lines 41, 105, 116, 138, 253-254) |
| -1C  | `review/kv.ts` — characterization tests for `populateReviewQueue` (exercises `as any[]` at line 513) |

**GATE**: All characterization tests pass before Batch 0 begins.

### Batch 0 (Sequential — must complete before all other batches)

DTO schemas and snapshot tests. These define the wire types that all other tests reference.

| Task | Target                                                                                       |
| ---- | -------------------------------------------------------------------------------------------- |
| 0A   | `dto/audit-finding.ts` + `dto/audit-job.ts` + `dto/question.ts` — core pipeline wire types   |
| 0B   | `dto/review.ts` + `dto/judge.ts` + `dto/manager.ts` — queue wire types                       |
| 0C   | `dto/auth.ts` + `dto/gamification.ts` + `dto/webhook.ts` + `dto/store.ts` — support types    |
| 0D   | KV key-schema snapshot test — asserts all known key prefixes                                  |

**GATE**: All Batch 0 snapshot tests pass + Batch -1 characterization tests still pass before Batch 0.1 begins.

### Batch 0.1 (Sequential — `as any` cast elimination)

Eliminate `as any` casts on DTO-typed data. This is a production code change — Batch -1 characterization tests are the safety net.

| Task | Target                                                                                       |
| ---- | -------------------------------------------------------------------------------------------- |
| 0.1A | `controller.ts` — replace `as Record<string, any>` and `as any` casts with DTO types        |
| 0.1B | `steps/finalize.ts` — replace `as any[]` casts with DTO types                                |
| 0.1C | `review/kv.ts` — replace `as any[]` cast with DTO type                                       |

**GATE**: Batch -1 characterization tests still pass (cast removal didn't change behavior) + grep confirms zero `as any` on DTO-typed variables. Then Batch 1 begins.

### Batch 1 (Sequential — badges must complete before Batch 2)

Unit tests for pure functions. **Task 1C (`shared/badges.ts`) is a Batch 2 prerequisite** because `review/kv.ts:7`, `judge/kv.ts:6`, and `manager/kv.ts:6` all import `checkBadges` from `shared/badges.ts`. Tasks 2D/2E/2F exercise `checkBadges` at runtime during `recordDecision` flows. If 1C modifies `shared/badges.ts` for testability after 2D/2E/2F are already written, those integration tests break. The remaining tasks (1A, 1B, 1D-1I) are genuinely independent of each other and of Batch 2, and CAN run in parallel with Batch 2 after 1C completes.

**Execution order**: Run 1C first. After 1C is merged, run 1A/1B/1D-1I and Batch 2 in parallel.

| Task | Target                                                                                                                 | Parallel? |
| ---- | ---------------------------------------------------------------------------------------------------------------------- | --------- |
| 1C   | `shared/badges.ts` — checkBadges, rarityFromPrice, STORE_CATALOG snapshot                                              | **First** (Batch 2 prerequisite) |
| 1A   | `types/mod.ts` — createJob, pickRecords, markAuditDone, createFinding, normalizeAnswer, answerQuestion, createQuestion | After 1C  |
| 1B   | `providers/question-expr.ts` — populateQuestions, parseAst, pullNotes                                                  | After 1C  |
| 1D   | `shared/combometer.ts` — Combometer class                                                                              | After 1C  |
| 1E   | `providers/pinecone.ts` — chunkText (extracted pure function)                                                          | After 1C  |
| 1F   | `providers/groq.ts` — makeUserPrompt, parseLlmJson                                                                     | After 1C  |
| 1G   | `providers/assemblyai.ts` — identifyRoles                                                                              | After 1C  |
| 1H   | `steps/ask-batch.ts` — strToBool                                                                                       | After 1C  |
| 1I   | `lib/org.ts` — orgKey                                                                                                  | After 1C  |

### Batch 2 (PARALLEL with Batch 1 remainder — after 1C completes)

Integration tests for data layer. **Depends on 1C** — `review/kv.ts`, `judge/kv.ts`, and `manager/kv.ts` import `checkBadges` from `shared/badges.ts` at runtime. 1C must be merged before 2D/2E/2F begin to avoid test breakage from `shared/badges.ts` modifications.

| Task | Target                                                              |
| ---- | ------------------------------------------------------------------- |
| 2A   | `lib/kv.ts` — ChunkedKv, finding CRUD, job CRUD, cache              |
| 2B   | `lib/kv.ts` — stats tracking, webhook, events, messaging            |
| 2C   | `auth/kv.ts` — authenticate, createOrg, createUser, verifyUser      |
| 2D   | `review/kv.ts` — populateReviewQueue, claimNextItem, recordDecision. **Must include characterization tests**: capture exact KV key/value pairs written by `populateReviewQueue` for known inputs. Test the `recordDecision → populateManagerQueue` chain (`review/kv.ts:214-222`). |
| 2E   | `judge/kv.ts` — populateJudgeQueue, appeals. **Must include characterization tests**: capture exact KV key/value pairs written by `populateJudgeQueue` for known inputs. |
| 2F   | `manager/kv.ts` — populateManagerQueue, submitRemediation, getManagerStats. **Must include characterization tests**: capture exact KV reads (review-decided) and writes (manager-queue) for known inputs. |

### Batch 3 (Depends on Batch 2 — touches coordinators)

Integration tests for pipeline steps and handlers:

| Task | Target                                                                            |
| ---- | --------------------------------------------------------------------------------- |
| 3A   | Pipeline steps (init, transcribe, diarize, prepare, ask-batch, finalize, cleanup) |
| 3B   | Review handlers                                                                   |
| 3C   | Judge handlers                                                                    |
| 3D   | Manager handlers + Agent handlers                                                 |
| 3E   | Question Lab handlers                                                             |
| 3F   | Controller (handleAuditByRid, handlePackageByRid, etc.)                           |

### Batch 4 (Depends on Batch 3)

E2E tests — critical paths only (Phase 1 E2E is minimal per Safety Invariant S5):

| Task | Target                                                                  |
| ---- | ----------------------------------------------------------------------- |
| 4A   | Auth E2E (register, login, role redirect) — critical path               |
| 4B   | Audit Pipeline E2E (trigger by RID → pipeline completes) — critical path |
| 4C   | Review Queue E2E (login as reviewer, claim, decide) — critical path     |

These 3 specs cover the core user journeys. They test against template literal HTML (throwaway in Phase 4). Comprehensive E2E (~9 specs, ~30 cases) is written in Phase 4 against the Fresh frontend (the permanent architecture).
