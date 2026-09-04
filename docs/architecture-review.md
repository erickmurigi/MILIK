# MILIK — Architecture, Performance & Code-Reuse Review

**Scope:** MilikApi (Express/Mongoose) + MilikClient (React/Vite) + MilikMobile (Expo, lightly touched). Read-only review, no code changed.
**Method:** Direct reading of source, config, `package.json`s, `server.js`, `.env.example`, `ecosystem.config.cjs`, CI workflow, git history (419 commits, Apr–Sep 2026), and representative model/controller sampling — not framework assumptions.
**Context supplied:** ~dozens of companies / tens of thousands of records; single VPS, PM2 cluster + Nginx, manual deploy; zero downtime tolerance; no specific pain point named — this is a baseline health check, not a triage.

---

## 1. Current state

### What MILIK is
A multi-tenant SaaS covering five business modules on one shared backend/frontend: **Property Management** (tenants, leases, invoicing, receipts, deposits, landlord accounting, full GL), **Car Wash**, **HR/Payroll**, **Inventory & POS**, and **Property Sale**, plus a shared **Accounts** layer (Chart of Accounts, Journal Entries, GL) reused across whichever modules a company has enabled. Multi-tenancy is a shared-schema, `business`-field-scoped model (one Mongo cluster, one set of collections, every document tagged with its owning company) — not schema-per-tenant or DB-per-tenant.

- **Backend:** Express 4 + Mongoose on Node 22, single `server.js` (988 lines) wiring 200+ routes across `controllers/`, `modules/{carwash,clients,hr,inventory,propertySale}/`, and `services/`. 122 Mongoose model files. JWT auth (7-day token, blacklist-based revocation — just hardened this session). Socket.IO for realtime, with a Redis adapter for cross-worker fan-out. `node-cron` for four in-process scheduled jobs (billing, auto-invoicing, overdue-marking, renewal reminders), guarded to run on one PM2 worker only.
- **Frontend:** React 18 SPA on Vite (SWC), Redux Toolkit + redux-persist, react-router v6. 225 page files, 60 shared components, 18 redux slices, 9 custom hooks. A custom in-app tab-manager (`TabManager.jsx`) simulates a browser-tab UX per "workspace" (module), persisted to localStorage per company.
- **Deploy:** Single VPS. PM2 cluster mode, `instances: "max"` (one worker per core), Nginx in front, `git pull` + PM2 restart is the deploy mechanism (no CD pipeline). Uploads split between local disk (`MilikApi/uploads/`, 8 call sites) and Cloudinary (3 call sites, mainly HR employee photos).
- **CI:** GitHub Actions (`.github/workflows/ci.yml`) runs on every push/PR to `main`: client build, client lint (non-blocking), API `node --check` syntax sweep, and the API's Vitest suite. No CD — a green run doesn't deploy anything.
- **Tests:** Vitest + `mongodb-memory-server` **replica set** (required because ledger posting uses real Mongo transactions) — 21 test files, 64 tests, concentrated on the financial core (ledger posting, invoicing, receipt allocation, credit notes, GL integrity) built out earlier this session.

### What's solid
This is a materially better foundation than "no solid foundation" self-assessments usually turn out to be. Specifically:

- **Security middleware baseline is genuinely good**: `helmet` with an explicit CSP, `cors` with an origin allowlist (not a wildcard), `hpp`, request-level `mongo-sanitize`, `express-rate-limit` on auth/trial/company-creation/public-listing endpoints, `trust proxy` set correctly, JWT verified with explicit issuer/audience/algorithm, a real token-blacklist (Mongo-backed with an in-memory hot cache) for revocation on logout/refresh.
- **Graceful shutdown** (`SIGTERM`/`SIGINT` draining, 15s force-exit) — correct for PM2 zero-downtime restarts.
- **PM2-cluster-aware cron guard** (`isPrimaryWorker` check before scheduling jobs) — a common mistake (every worker firing the same cron and double-sending invoices/SMS) that's correctly avoided here.
- **PDF generation is a shared, pre-warmed, singleton Puppeteer browser per worker** (`services/browserService.js`) with reconnect/reset handling — not a naive "launch Chromium per request" pattern.
- **Vite build config is mature**: manual vendor chunking (react/router/redux/charts/xlsx/socket/icons split out), esbuild minify, console-stripping, CSS code-splitting, ES2018 target. Bundle output from this session's builds: main `index` chunk 550KB (148KB gzip), heaviest vendor chunks (`xlsx` 425KB, `recharts` 324KB) are already isolated so they don't inflate the initial load.
- **Core accounting models are well-indexed and clearly reasoned about**: `TenantInvoice` and `FinancialLedgerEntry` each carry 10+ deliberate compound indexes with comments explaining which query/report they cover (e.g. "Optimized for liability subledger drill-down"). This is what "well-indexed" should look like everywhere — it just isn't everywhere yet (§3).
- **A real CI pipeline exists** and actually runs the test suite against a transactional Mongo replica set, not a smoke test.
- **A real test foundation exists** on the highest-stakes code path (GL posting) — the part of the system where a silent bug is a money bug.

### What's fragile
- **One 988-line `server.js`** is the single place every new resource must be wired into by hand (import + `app.use`), with no consistent registration convention across modules (see §2, ARCH-1). It's already the #3 most-churned file in the repo's git history (64 changes).
- **No CD, no staging environment evidence, deploy is a manual VPS step** — every ship is a manual, un-audited action with no automatic rollback path.
- **Reuse is thin relative to surface area**: 225 pages vs. 60 shared components/9 hooks. Several real bugs fixed *this session alone* were exactly this shape — the same problem (a stale-URL-derived state, a local dropdown reimplementation instead of the shared one, hand-rolled pagination) solved slightly differently, and slightly wrong, in more than one place.
- **A real secret is checked into git** (§2, SEC-1) — the most urgent single item in this review.
- **Background/scheduled work is entirely in-process** (`node-cron` inside `server.js`) despite Redis already being a first-class dependency — there's no durable job queue, so a crash mid-cron-tick leaves no retry trail.

---

## 2. Findings

Ranked Critical → Low. Each is: what / where / why it matters / the fix.

### 🔴 CRITICAL

**SEC-1 — Live-looking Cloudinary credentials committed to git, in a file meant to be a safe template**
- **Where:** `MilikApi/.env.example:58-60`
- **What:** Every other value in this file is an obvious placeholder (`replace-with-a-long-random-secret...`, `smtp.example.com`, `change-me-now`). The Cloudinary block (`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`) instead holds what reads as a real cloud name, a real numeric API key, and a real-format API secret — not placeholders. I have not echoed the values anywhere, including here.
- **Why it matters:** `.env.example` is tracked in git (correctly — `.gitignore` explicitly `!.env.example`s it) and has been since `git log`'s earliest commit ("Initial clean MILIK source push"). If this repository is or was ever public, or if anyone besides you has ever cloned/forked/viewed it, that credential is compromised — and deleting the line today does **not** remove it from git history. The real `.env` files were correctly never committed (verified via `git log --all -- MilikApi/.env` — empty), so this is contained to this one credential, not a full secrets leak — but it's still a live-looking key sitting in version control.
- **Fix (do this regardless of repo visibility, it's cheap insurance):**
  1. In the Cloudinary dashboard, rotate (regenerate) the API secret for that cloud name now.
  2. Update the real production `.env` on the VPS with the new secret.
  3. Replace `MilikApi/.env.example:58-60` with the same style of placeholder as everything else in that file.
  4. If the repo has ever been public, treat the *old* key as burned — rotation is the fix, not a history rewrite (a `git filter-repo`/BFG rewrite + force-push is high-risk on a live team repo and isn't necessary once the key itself is rotated).
- **Open question for you:** is `erickmurigi/MILIK` a public or private repository? I couldn't check (`gh` isn't available in this environment) — this changes urgency but not the fix.

### 🟠 HIGH

**PERF-1 — Rate limiting silently degrades to ~1/4 strength in production if `REDIS_URL` isn't set**
- **Where:** `MilikApi/server.js:441-506` (`buildStore`), `MilikApi/utils/redisClient.js`, `MilikApi/ecosystem.config.cjs:8` (`instances: "max"`, `exec_mode: "cluster"`)
- **What:** Every rate limiter (`authLimiter`, `generalLimiter`, `trialLimiter`, `companyCreationLimiter`, `publicListingsLimiter`) uses a Redis-backed store *only if* `REDIS_URL` resolves; otherwise `rate-limit-redis`'s `buildStore()` returns `undefined` and `express-rate-limit` silently falls back to its default **in-memory** store — which is **per process**. PM2 is configured for cluster mode with one worker per core. Four independent in-memory counters means a client load-balanced across workers can get up to ~4× the configured attempts before any single worker's counter trips (e.g. the 15-attempts-per-15-min login limiter effectively becomes ~60/15min).
- **Why it matters:** This is exactly the kind of gap that doesn't show up in dev (single process, no PM2) or in code review (the code is *correct* when Redis is configured) — it only shows up as a silent, unannounced weakening of every rate limit in production, and there is no error surfaced beyond a `console.warn` on Redis connection failure.
- **Fix:** Confirm `REDIS_URL` is actually set on the production VPS (open question below — I can't see this from the repo). If it isn't, that's the fix. If it is, add a startup assertion: fail loudly (or at minimum log at `error` level, not the current silent `console.warn`) if `getRedisClient()` returns `null` in `NODE_ENV=production`, so this can never regress unnoticed again.

**PERF-2 — Company-context cache is per-worker, not shared, in a 4-worker cluster**
- **Where:** `MilikApi/controllers/verifyToken.js:9-29` (`_companyCache`, 60s TTL, 500-entry cap, plain in-process `Map`)
- **What:** Every authenticated request resolves the active company via `attachResolvedCompany` → `getCachedCompany`, which hits Mongo only on a cache miss and otherwise serves from this in-memory `Map`. In PM2 cluster mode there are 4 independent instances of this cache, one per worker.
- **Why it matters:** A company-level change that should take effect immediately — locking a company, toggling a module, changing `accountStatus` — can appear inconsistently across requests for up to 60s depending on which worker handles each request, and different users (or the same user's parallel dashboard requests) can transiently see different company state in the same window. At today's scale this is a minor UX glitch; it becomes a real correctness problem the moment "lock this company NOW" (e.g. a compliance/billing action) is expected to be immediate.
- **Fix:** Either move this cache to Redis (already a dependency, already used for rate limiting) so it's shared across workers, or add an explicit invalidation call (`invalidateCompanyCache`, which already exists) to every mutation path that changes company state — right now it's unclear whether all such paths call it consistently (worth a grep sweep before choosing the fix).

**CODE-REUSE-1 — No shared pagination/list-query helper; hand-rolled per controller**
- **Where:** repo-wide — I found no `paginate`/`buildPagination` utility anywhere under `MilikApi/utils`. Confirmed by grep.
- **What:** Every list endpoint implements its own page/limit/search/filter logic inline. This already produced a real, shipped correctness bug this session: `getStatementsByBusiness` (processed statements) applied its search filter *after* pagination instead of before, meaning a search could silently return an empty or wrong page even when matches existed on other pages — fixed earlier in this project's history, but the *pattern* that caused it (every controller reinventing pagination+filtering by hand) is still the norm across the other ~300 controller/service files.
- **Why it matters:** This isn't a style nitpick — it's a correctness bug factory. With 122 models and this many hand-rolled list endpoints, the odds that this exact class of bug (filter-after-paginate, off-by-one page math, inconsistent default sort) recurs elsewhere are high, and each instance has to be found the hard way (a user report) rather than prevented by construction.
- **Fix:** see §4's "declare-once" plan — a single `buildListQuery({ model, filters, search, searchFields, page, limit, scope })` helper, adopted incrementally per-endpoint (never as a big-bang rewrite).

**PERF-3 — N+1 (per-item awaited DB call inside a loop) confirmed in ~10 production controllers, concentrated in Car Wash**
- **Where (production code, excluding one-off admin/migration scripts which are a different risk category):** `controllers/propertyController/latePenalties.js`, `controllers/propertyController/expenseRequisition.js`, `services/statementSnapshotService.js`, `modules/clients/services/renewalReminderService.js`, and **6 files in `modules/carwash/controllers/`** — `commissionsController.js`, `branchController.js`, `jobsController.js`, `expensesController.js`, `depositsController.js`, `settingsController.js`.
- **Why it matters:** This is the exact bug shape already found and fixed multiple times in the PMS module earlier in this project's history (sequential `.save()` loops converted to `Promise.allSettled`, per-item ledger lookups batched into single queries, ~15 unscoped `countDocuments` calls fixed). Car Wash — the single largest module by file count (65 files) and among the most git-churned (`jobsController.js`, `mpesaCallbackController.js`, `loyaltyController.js` are all in the top-25 most-changed files repo-wide) — has never been through that same pass. At "dozens of companies" scale this is tolerable; it will not be once any single company's job/commission history grows past a few thousand records.
- **Fix:** Same remediation pattern already proven in the PMS module this session — batch the lookups with `$in`, convert sequential saves to `insertMany`/`bulkWrite`/`Promise.allSettled`. Treat this as a scoped, low-risk sweep of exactly these ~10 files, not a rewrite.

**OPS-1 — Deploy is entirely manual with zero downtime tolerance and no CD**
- **Where:** `ecosystem.config.cjs` + your own confirmation (single VPS, PM2+Nginx, manual/scripted deploy)
- **What:** CI validates every push to `main` (build, syntax, tests) but nothing deploys automatically — going from "CI is green" to "it's live" is a manual step on the VPS, with no described rollback mechanism, staging environment, or smoke test after restart.
- **Why it matters:** Given "none — must stay up, strictly progressive" as your downtime tolerance, this is the single biggest risk to *that specific constraint* — not because deploys are likely to fail, but because when one does, recovery is manual and under pressure, on production, with real tenants' data on the line.
- **Fix:** progressive, no big-bang — see §5 step 1. The floor version costs almost nothing: a `/health`-check-after-restart step in the deploy script (the endpoint already exists at `server.js:511`) and a documented one-command rollback (`pm2 reload` to the previous build directory, or a tagged git ref).

### 🟡 MEDIUM

**ARCH-1 — `server.js` is a 988-line, hand-wired route registry with no declarative convention**
- **Where:** `MilikApi/server.js:1-141` (imports) and `:573-696` (route mounting) — 140+ `import` lines, 120+ `app.use(...)` lines, one file.
- **Why it matters:** Every new resource (and MILIK adds resources often — 419 commits in ~5 months) requires editing this file, which makes it a permanent merge-conflict magnet and — more importantly for a solo/small team — the one file where a copy-paste mistake (wrong middleware order, forgotten `verifyToken`) is easiest to make and hardest to spot in review, because there's no shape to compare against.
- **Fix:** not a rewrite — a **module manifest pattern**, adopted one module at a time (see §4).

**ARCH-2 — Ad-hoc, unconditional data migrations embedded in server boot**
- **Where:** `MilikApi/server.js:796-819` — two `updateMany` "one-time migration" blocks run inside `startServer()`, *before* the `isPrimaryWorker` gate that protects the cron jobs just below them.
- **Why it matters:** They're idempotent (filtered `updateMany`s, safe to repeat) so this isn't a correctness bug today — but all 4 PM2 cluster workers execute both on every single restart, forever, which is wasted DB round-trips on every deploy, and it establishes a pattern (migrations as inline boot code with no ledger of what's already run) that will get harder to reason about as more accumulate.
- **Fix:** a tiny `migrations` collection recording `{name, ranAt}`, checked once by the primary worker only, or move to a proper migration runner if one gets adopted (not required — the collection-ledger version is a 20-line fix).

**PERF-4 — Puppeteer is a shared singleton per worker, sized against a tight PM2 memory ceiling**
- **Where:** `MilikApi/services/browserService.js` (the browser itself) vs. `MilikApi/ecosystem.config.cjs:11` (`max_memory_restart: "500M"`)
- **What:** The Puppeteer implementation itself is good (§1) — one pre-warmed headless Chromium per worker, not per-request. But each of the 4 PM2 workers now carries Node + a live Chromium process against a 500MB restart ceiling *per worker*. A headless Chromium instance alone commonly sits in the 100-300MB range, before any concurrent PDF pages are open on it.
- **Why it matters:** I have no production memory/restart logs to confirm this is *currently* triggering (this is a "watch it," not a "fix it now"), but it's a real tension worth quantifying: a burst of concurrent PDF generation (e.g. the 08:00 EAT billing cron firing statements across many companies at once, overlapping with normal daytime invoice-download traffic) is a plausible OOM-restart trigger on whichever worker handles it, which would be a mid-request 502, not a graceful failure.
- **Fix:** check `pm2 logs`/`pm2 status` restart counts on the VPS for evidence either way before spending effort here. If it's real, the fix is a memory ceiling bump for PDF-heavy workers, not an architecture change.

**TEST-1 — Coverage is deep on the financial core, essentially absent on 4 of 5 business modules**
- **Where:** 21 test files / 64 tests total, vs. 315 controller/service files and 122 models. All 21 test files concentrate on ledger posting, invoicing, receipt allocation, and related PMS financial flows.
- **Why it matters:** This is the right place to have started (money bugs are the worst kind), but it means Car Wash, HR, Inventory/POS, and Property Sale — 4 of the 5 modules, and the modules with the highest git churn outside PMS — have zero automated regression coverage. Every fix to those modules today relies entirely on manual click-testing to avoid a regression.
- **Fix:** not "write tests for everything" — pick the 2-3 highest-value flows per module (the ones with money or state-machine transitions: Car Wash job → payment → commission, HR payroll run, Property Sale deal → commission) and use the exact `test/factories.js` + `callController.js` harness already built this session. That harness is itself good, reusable infrastructure — it just hasn't been pointed at these modules yet.

**CODE-REUSE-2 — Component-to-page ratio suggests widespread per-page reimplementation**
- **Where:** 225 page files vs. 60 shared components / 9 hooks (`MilikClient/src/components`, `src/hooks`).
- **Why it matters:** This ratio alone isn't damning, but it's consistent with — not just theoretically related to, but the *literal same bug shape as* — three separate real bugs fixed this session: a local `MilikSelect` reimplementation duplicating the shared portal-based `AppSelect` (clipped by ancestor overflow, fixed by deleting it and using the shared one at 16 call sites); the Payment Voucher page's modal-open state going stale because it was derived from the URL only once at mount instead of via a `useEffect`, instead of using the pattern the codebase's own `AddTenant.jsx` already gets right (`useParams()` read fresh every render); and hand-rolled pagination state repeated per list page.
- **Fix:** see §4 — a small set of composable page-shell primitives (list-page shell, CRUD-form shell), adopted opportunistically whenever a page is touched for another reason, never as a dedicated migration.

**OPS-2 — Mixed file-storage strategy with no documented rule**
- **Where:** local disk (`MilikApi/uploads/`, `server.js:160-161,571`) used at 8 call sites; Cloudinary used at 3 (mainly HR employee photos, per `.env.example:57`'s comment).
- **Why it matters:** Not wrong on a single VPS today, but it means two different backup/durability stories exist for user-uploaded content with no visible rule for which resource type gets which, and local-disk uploads have no described backup strategy separate from whatever backs up the VPS as a whole (open question below).
- **Fix:** document the rule (probably already exists in your head — worth writing down), and confirm local `uploads/` is actually included in whatever backup process protects the VPS.

### 🟢 LOW

**ARCH-3 — Client `.env.example` has a stray corrupted first line**
- **Where:** `MilikClient/.env.example:1` — `I HAVE S# MILIK Client - local development template`. Cosmetic (a stray keystroke before the comment), not a leaked secret — every other value in this file is a clean placeholder. Worth a one-line cleanup, and a reminder that these template files could use a quick proofread pass given SEC-1 above.

---

## 3. Performance & scaling

*(Findings already detailed above are cross-referenced rather than repeated.)*

| Area | Status | Detail |
|---|---|---|
| **N+1 queries** | 🟠 Confirmed in ~10 files | See PERF-3. Concentrated in Car Wash; PMS module already swept and fixed this session. |
| **Missing/wrong indexes** | 🟡 Mostly good, correctness gaps hide inside it | 116 of 122 model files define at least one custom index. `TenantInvoice`/`FinancialLedgerEntry` are exemplary. But "has an `index()` call" ≠ "the index matches the real query" — this session already found and fixed one case (`LatePenaltyBatch` querying a top-level field that only existed nested inside an array, so the index — and the query — silently matched nothing). **Recommendation:** don't assume the remaining 116 are all correct; a `.explain()` audit of the top 15-20 hottest list/report endpoints (starting with Car Wash, given PERF-3) is cheap and would catch more of this class. |
| **Unbounded/unpaginated endpoints** | 🟡 Pattern risk, not proven widespread | One real fixed example this session (`getLandlordPayments` capped at 50 records, silently truncating rather than paginating). Root cause is CODE-REUSE-1 (no shared pagination helper) — same fix serves both. |
| **Sync work that should be background jobs** | 🟢 Partially good, one gap | The 4 cron jobs are correctly cluster-guarded (`isPrimaryWorker`) and run off the request path — good. The gap: Redis is already a dependency (used for rate limiting + Socket.IO adapter) but there's no durable job queue (Bull/BullMQ would be the natural fit) — a crash mid-cron-tick today just logs and moves on, with no retry ledger. Not urgent at "dozens of companies" scale; worth planning for before this grows further. |
| **Caching** | 🟡 One correctness-relevant gap | See PERF-2 (company-context cache not shared across PM2 workers). No other application-level caching found beyond that and the rate-limiter's Redis store — which is itself conditional on Redis being configured (PERF-1). |
| **DB connection/pool config** | 🟢 Reasonable | `maxPoolSize: 50, minPoolSize: 10` (`server.js:729-735`) across 4 cluster workers = up to 200 connections to Mongo at peak. Fine for a managed Atlas cluster at this scale; worth a one-time check that your Atlas tier's connection limit comfortably exceeds 200 as company count grows. |
| **Frontend bundle** | 🟢 Already well-handled | Manual vendor chunking already isolates the heaviest libraries (`xlsx` 425KB, `recharts` 324KB) from the 550KB main chunk. Nothing to fix here today — flagging only because it's exactly the kind of thing that regresses silently if a future dependency gets added without updating `manualChunks`. |
| **Frontend list/table rendering** | ⚪ Not deeply audited this pass | 225 pages is too many to individually verify virtualization/pagination behavior in a read-only pass of this scope. Given CODE-REUSE-2's pattern (per-page reimplementation), it's a reasonable bet that some list pages render full result sets client-side rather than paginating — worth a targeted look at the 3-5 pages handling the largest datasets (tenant invoices, receipts, journal entries) specifically. |

**Net read:** nothing here says "this system is slow today" — at "dozens of companies, tens of thousands of records" everything found is either already mitigated (indexes, chunking, connection pool) or a *risk that compounds with growth* rather than a current bottleneck (N+1s in the least-scrutinized module, cache-sharing across workers, rate-limiter degradation). The right response is the sweep-and-batch pattern already proven on PMS this session, pointed at Car Wash next — not a scaling redesign.

---

## 4. Target architecture

**Where it should land**, with the explicit constraint that every step below must be reachable incrementally, live, with zero downtime — this is a *hardening* target, not a rewrite target.

### 4.1 One consistent API/list/error contract
Every list endpoint should return the same shape: `{ data: [...], total, page, pages }` (some already do — e.g. `getPaymentVouchers` per `PaymentVouchers.jsx`'s usage — this is about making it universal, not inventing something new). Paired with a single server-side `buildListQuery()` helper (CODE-REUSE-1) that every controller calls instead of hand-rolling `skip`/`limit`/`$or` search logic. **Trade-off:** touching ~300 controllers is real work — but each one is a small, independent, testable diff (swap the hand-rolled block for the helper call), not a migration that has to land atomically.

### 4.2 A "declare-once" resource pattern for `server.js`
Instead of 140 imports + 120 `app.use()` calls in one file, a per-module manifest:
```js
// modules/carwash/manifest.js
export default {
  prefix: "/api/carwash",
  routes: [
    { path: "/services", router: servicesRouter },
    { path: "/jobs", router: jobsRouter },
    // ...
  ],
};
```
...loaded by one small loop in `server.js`. **Trade-off:** this is the one target-architecture item that touches the file every deploy depends on — so it must be done *by module*, verified live after each (PMS stays untouched first; start with the newest/smallest module, Property Sale or Clients, as the proof of pattern), never all at once. Full payoff (a `server.js` that's 50 lines instead of 988) only arrives after every module has migrated — that's fine; each intermediate state is fully functional.

### 4.3 Shared base layers (reuse plan)
- **Backend:** `buildListQuery()` (4.1), a `migrations` ledger collection (ARCH-2), a Redis-backed (not per-worker) company-context cache (PERF-2).
- **Frontend:** a `<ListPageShell>` composing the pagination/search/filter chrome every list page currently reimplements, and a route-aware `useRouteModalState(matchPath)` hook generalizing the fix just shipped for the Payment Voucher bug (PaymentVouchers.jsx) so the *next* page with a list+`/new`-sibling-route pattern gets it right by construction instead of by another live bug report. Both are opt-in, adopted page-by-page whenever a page is touched anyway — never a forced migration.
- **Design system:** the `AppSelect` consolidation already completed this session (deleting the duplicate `MilikSelect`) is the template — the same audit (grep for other single-purpose local reimplementations of a shared component) is worth repeating periodically, not just once.

### 4.4 CI → CD, staged
Given zero downtime tolerance, the target is **not** "auto-deploy on merge to `main`" on day one. It's: CI status becomes a required check on `main` (confirm branch protection — I can't verify this from the repo, see open questions) → a scripted, repeatable deploy (even manually-triggered) that includes the `/health` check and a documented rollback → *then*, once that's proven reliable by hand a few times, consider automating the trigger. Each stage ships value on its own.

---

## 5. Incremental hardening roadmap

Ordered by (impact × how independently shippable it is). Nothing here requires downtime; nothing requires a big-bang migration. Dependencies are called out explicitly.

1. **Rotate the Cloudinary credential (SEC-1).** Zero dependencies, zero risk, do this first regardless of anything else. *(hours)*
2. **Confirm `REDIS_URL` is actually set in production (PERF-1) — this is a question, not a code change**, then add the "fail loudly if missing in production" assertion. *(hours, once you tell me the current state)*
3. **Confirm branch protection on `main` requires the CI check to pass (OPS-1 groundwork)** — again a settings check, not code.
4. **N+1 sweep on Car Wash's 6 flagged controllers (PERF-3)**, using the exact batching pattern already proven on the PMS module this session. Independent per-file; ship one controller at a time.
5. **Company-cache sharing fix (PERF-2)** — small, isolated change to `verifyToken.js`, no dependency on anything else here.
6. **Migration ledger for the two inline `server.js` migrations (ARCH-2)** — small, isolated, no dependency.
7. **`buildListQuery()` helper (CODE-REUSE-1 / 4.1)**, introduced once and then adopted incrementally per-controller as each is touched for other reasons — do **not** schedule a dedicated migration sprint for this; let it accrue naturally, but track adoption so it doesn't stall at "helper exists, nobody uses it."
8. **Deploy script hardening (OPS-1 / 4.4)**: add the `/health` check + documented rollback to whatever script currently runs `git pull` + `pm2 restart`. Depends on nothing above; can happen in parallel with everything else.
9. **`server.js` manifest pattern (ARCH-1 / 4.2)**, starting with the smallest/newest module as proof of pattern. This is the one item to sequence *after* 4-8 are stable, since it touches the file every other route depends on — do it when nothing else is mid-flight.
10. **Test coverage expansion into Car Wash/HR/Inventory/PropertySale (TEST-1)**, using the existing `factories.js`/`callController.js` harness. Best done *alongside* step 4 (the N+1 fixes) — a regression test for each fixed controller is the cheapest way to add coverage, rather than a separate testing initiative.
11. **Frontend `<ListPageShell>` / `useRouteModalState` extraction (CODE-REUSE-2 / 4.3)** — lowest urgency, highest long-term payoff. Adopt opportunistically whenever a list or list+form page is touched for any other reason.

**Leave alone for now:** the overall multi-tenant data model (shared-schema + `business` scoping is working, well-indexed on the core financial models, and a migration to per-tenant DBs would be a large, risky change with no evidence it's currently needed at this scale); the Socket.IO/Redis-adapter setup (already correct); the Vite build config (already mature); Puppeteer's implementation (already good — PERF-4 is a "watch," not a "change").

---

## 6. Open questions for you

1. **Is `erickmurigi/MILIK` a public or private GitHub repository?** (SEC-1 — I couldn't check; `gh` isn't available in this environment.) This changes how urgently the Cloudinary rotation needs to happen, though the fix is the same either way.
2. **Is `REDIS_URL` actually configured on the production VPS today?** (PERF-1) — if yes, this finding downgrades from "confirmed gap" to "add a guard so it can't regress"; if no, it's a same-day fix.
3. **Is branch protection on `main` set to require the CI checks to pass before merge?** I can see the workflow exists but not whether it's enforced.
4. **What currently backs up the VPS** (full-disk snapshots? something narrower?) — and does that backup include `MilikApi/uploads/` specifically, or only the database? (OPS-2)
5. Any appetite for adding **BullMQ** (or similar) now that Redis is already a dependency, to replace the in-process `node-cron` jobs with a durable, retryable queue — or is the current setup (correctly cluster-guarded, but no retry ledger) fine at today's scale?
6. Should the Car Wash N+1 sweep (step 4) happen before or after the next feature push into that module — i.e. is now a good time to touch those 6 files, or is there active feature work there I'd be colliding with?

---

*No code was modified, no packages installed, nothing deployed, in producing this review.*
