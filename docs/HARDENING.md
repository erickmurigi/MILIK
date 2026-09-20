# Hardening & Optimization Status

Living status document for the security hardening and system optimization work
started 2026-09-12/13. Eight tracks: bug fixes landed on `main` (Track A), the
security hotfix (Track B, **merged and deployed**), an unplanned second wave
of landlord-statement bug fixes found via live user testing (Track D), the
whole-codebase optimization audit (Track C — **closed**), and a module-by-
module correctness-then-performance pass now underway: CarWash (Track E
correctness, Track F performance) and PropertySale (Track G correctness, Track
H performance) are **closed**; next module TBD.

---

## Track A — Landlord statement / receipt fixes (committed on `main`)

All committed and tested (backend suites green). Frontend changes have since
been **manually verified in-browser by the user** — all 4 checklist items
confirmed working (receipt creation/confirmation badge behavior, allocation
tags surviving confirm, Statement Allocations prepayment lifecycle display).

| Commit | Summary |
|---|---|
| `0def581` | Fix: stop double-counting untagged unapplied receipt rows in the raw ledger (`getReceiptRentLedgerCash`) |
| `feb278d` | Fix: `confirmPayment` was dropping a prepayment's `isPrepayment`/`billItemKey`/`prepaymentLabel` tags when rebuilding allocations on confirm |
| `6f53c68` | Feat: surface a receipt's held-prepayment history on the Statement Allocations admin page (new `prepayment_recognized` audit trail + "Type" badges); also fixed the admin "Mark as Prepayment" tool dropping the same tags |
| `375f105` | Feat: company-wide manual receipt confirmation policy (`on_save` vs `on_review`), replacing the per-receipt "Mark as Confirmed" checkbox |
| `99c056b` | Chore: removed 3 confirmed-dead backend files (see Track C, item C-B2) |
| `aed62e9` | Fix: found during browser verification — saving the confirmation-policy toggle persisted correctly server-side but never updated the Redux-cached settings, so the AUTO-CONFIRMED badge stayed stale until a hard reload |

---

## Track B — Security hotfix (**merged and deployed**)

Branch `fix/security-hotfix-2026-09-12` → PR #1 → merged into `main` as
`96dfe3b`, pulled and deployed to milikproperty.com. A production outage
during deploy (502s, Mongo `bad auth`) turned out to be an unrelated Atlas
password-rotation gap — production `.env` still had the pre-rotation
password — fixed by updating it on the server and restarting the process;
resolved by the user directly.

Full test suite: 28/28 files, 115/115 tests passing as of last full run pre-merge.

| Commit | What |
|---|---|
| `929c73e` | `Printer.js` — `getPrinter`/`deletePrinter` had zero business scoping (cross-tenant read/delete); `getPrinters`/`createPrinter` trusted client-supplied business id |
| `d8d61a6` | `server.js` — JWT_SECRET now validated at boot instead of lazily on first request |
| `4cbc40c` | CarWash M-Pesa public callback routes — added `safaricomIPWhitelist` (previously no auth, no IP restriction at all) |
| `3ac8981` | `tenantInvoices.js: bulkImportInvoiceNotes` — rejects with 400 instead of silently querying every tenant/invoice system-wide when business can't be resolved; added `.select()`/`.limit()` |
| `121ef0b` | `tenantInvoices.js: deleteTenantInvoicesBatch` — perf: sequential-per-id loop → bounded concurrency via `runTasksInChunks` |
| `ed0524a` | **Root-cause fix**: `utils/requestContext.js`'s `resolveBusinessId`, shared by 33 files (HR, CarWash, Clients, PropertySale, Inventory scope files, ~25 property controllers) — now mirrors the safe pattern in `verifyToken.js`'s `getActiveCompanyIdFromRequest` |
| `04efc82` | `getCreditableTenantInvoices` — now uses the file's own existing safe `resolveAuthorizedBusinessId` instead of raw `req.query.business` |
| `3ac7c93` | `ledgerDiagnostics.js` — 4 functions (incl. a WRITE that recomputes GL balances) matched to the file's own stricter sibling pattern |
| `88aa1ac` | `whtRemittance.js` — 4 functions (remit/void POST or reverse real GL entries) |
| `c5ff9c5` | `taxRemittance.js` — VAT's twin of the above |
| `01c3256` | `mpesaCollections.js` — 7 functions (list/import/delete/assign/ignore/unignore/register-urls) |
| `7d81db9` | `coopB2BCollections.js` — `listCoopCollections` |
| `6d3cfb3` | `paymentVoucher.js`, `landlordPaymentController.js`, `journalEntries.js` — each had a locally-duplicated insecure `resolveBusinessId` |
| `dcccc37` | HR entitlement bypass — 18 route files gated on `requireCompanyModule("hr")` + 18 new RULES-table entries; `/api/hr/ess/*` deliberately excluded (separate ESS auth model) |
| `7c6d200` | **`pettyCash.js`** — worst finding of the pass; `getBusinessId` never referenced `req.user.company` at all, across 12 endpoints including real money movements |

**Non-test-caller audit (requested before merge)**: checked all 4 scheduled cron
jobs (billing, auto rent invoicing, overdue/renewal marking, renewal reminders),
the public M-Pesa/Co-op webhook handlers, and internal service→controller
calls for any invocation of the 33 `resolveBusinessId`-dependent functions with
a missing or unrealistic `req.user`. **No issue found**:
- Cron jobs take explicit `business` params directly, or (the one exception,
  `autoRentInvoicingService.js` → `createTenantInvoiceRecord`) use a correctly
  constructed synthetic request (`{ user: { isSystemAdmin: true, company:
  businessId } }`) that satisfies both the old and fixed resolver logic.
- Public webhooks (PMS/CarWash M-Pesa callbacks, Co-op B2B validation/advise)
  resolve their business scope via shortcode/institution-code lookup, entirely
  independent of `req.user` — they don't touch the fixed functions at all
  (those are separate, admin-facing functions in the same files).
- The only other synthetic/`req: null` patterns in the codebase
  (`accrueCommissionForJob`, `resolveAuditActorUserId` call sites in CarWash)
  are for actor attribution, a separate, untouched utility.

**Sweep completeness caveat**: the sweep widened multiple times and found
something new each time (see method below) — treat it as thorough, not
provably exhaustive. If resuming: grep for `req.headers?.["x-active-company-id"]`
used without a following `canAccessCompanyId`-style check, and check
`modules/inventory/`, `modules/clients/`, `modules/propertySale/` controllers
directly for one-off local business-resolution bypassing their `*Scope.js`
helpers (as `pettyCash.js` did).

**Sweep method** (for continuing it): started from the 3 explicitly-named
files, then widened via (a) local `resolveBusinessId`/`getBusinessId`-named
function search, (b) direct `req.query`/`req.body` `.business`/`.businessId`/
`.company`/`.companyId` field access across `controllers/` and
`modules/**/controllers/`, (c) destructuring patterns, (d) header-based
(`x-business-id`) patterns, (e) URL-param-based (`req.params.businessId`)
patterns.

---

## Track D — Property Performance Statement bug fixes (unplanned, user-reported) — CLOSED

Not part of the original plan — surfaced through the user actively using the
statement pages in production and cross-checking numbers against other
reports. All committed to `main`, tests green throughout.

**Verification pass (all 4/4 confirmed clean, closing this track):**
1. Commission-basis labels — confirmed in real generated-PDF output for both
   modes: QUAD JOY (received) `Rent Received 132,156.00` / `Utility Received
   34,855.00`; BEAM WAY APARTMENTS (invoiced) `Rent Invoiced 191,700.00` /
   `Utility Invoiced 6,280.00`.
2. Missing-deposit-receipts fix — confirmed in KAILU SQUARE's actual
   generated PDF: all 6 previously-vanishing reference numbers present.
3. PDF footer removal — confirmed absent from the same generated PDF.
4. Notes-to-Landlord leak fix — a live frontend state bug, verified by the
   user directly in-browser (switched properties, confirmed the second
   property's notes were its own, not leaked from the first).

| Commit | What |
|---|---|
| `c355950` | **Root-cause fix**, two separate bugs both overstating Bal B/F/C/F: (1) receipt allocations targeting a since-*reversed* invoice or debit note were still treated as paying real debt (neither map had visibility into void documents to check against); (2) `getReceiptAllocationStatementImpact`'s debit-note branch read `allocationRow.category` expecting the real charge type, but that field is literally the string `"DEBIT_NOTE"` — silently dropping every UTILITY_CHARGE debit note as `statementRelevantAmount: 0`. Verified against live data: all 4 originally-flagged tenants (K1/K2/S3/S5) now match the Paid & Balance report exactly. |
| `7764d4b` | Bal C/F headline total switched from a net sum (arrears minus overpayments, which let one tenant's credit silently mask another's real debt) to gross arrears only — positive balances summed, credits excluded. |
| `be0c7ba` | Excluded credit balances surfaced as a plain, muted recap line ("Tenant credit balances — excluded from Bal C/F above") so that money isn't unaccounted-for now that it's no longer netted in. |
| `8b39985` / `13fd1f9` | A fuller deposit-arrears-visibility feature was added then reverted at the user's request (deemed not worth the added surface — unpaid deposits are rare enough not to need dedicated UI) |
| `bb8d65b` | Property filter added to the shared Ledger Account Activity page, gated behind `hasCompanyModule(company, "propertyManagement")` — a cashbook account can span multiple properties (verified: one account spanned 3), but the filter must stay invisible to the CarWash/HR/PropertySale/Clients companies that share this same page and have no concept of "property" |
| `8ee2141` | **Root-cause fix**: "Payments Collected Directly by Landlord" was built from a rent/utility-only receipt array (correctly restricted elsewhere for rent-ledger math) — reusing it here meant every landlord-direct *deposit* receipt vanished from the list entirely, no reference number, no trace. Fixed to include deposit receipts too, with correct type labeling (was silently mislabeled "Rent"). Also decoupled the table's own footer total from the Settlement Summary's income figure — they need different values now (one includes deposits, the other, correctly, never should). Verified: KAILU SQUARE's 55 direct receipts (49 rent + 6 deposit) now all appear, summing to exactly the Receipts Register's stated total. |
| `6989f35` | Copy cleanup: "Landlord-held deposit recognised from direct landlord receipt" → "Deposit collected directly" / "Deposit remitted by manager" — dropped internal-system-sounding jargon from a landlord-facing document. |
| `2c4b700` | **Real bug, found while auditing "does this work as expected"**: the Notes to Landlord textarea's state was never reset on property/period switch, and was being sent along with the *auto-regenerate* that fires (debounced) on every switch — not just the explicit Generate click. The backend does an unconditional overwrite whenever notes is non-empty. Net effect: switching properties could silently clobber a *different* statement's already-saved notes with leftover text from whichever one was viewed previously. Fixed by removing notes from the regenerate path entirely — they now only ever get written through the dedicated, correctly-scoped `PATCH /statements/:id/notes` endpoint. Also fixed the PDF template's notes rendering to use the file's own existing `esc()` helper instead of an incomplete ad-hoc `<`/`>`-only escape. |
| `b13b926` | UI request: removed the "Total collected directly by landlord" / "of which: Rent" / "of which: Deposit" totals footer from the printed PDF's direct-to-landlord table entirely — it now ends right after the last individual receipt row. PDF only; the live workspace kept its own total at the time (later also changed, see `6beee36`). |
| `12f5017` | The commission-basis-dependent summary label already existed but read like internal jargon ("Manager-held collections" / "Rent expected (Invoiced/Accrual)"), and only the invoiced-basis branch actually split Rent/Utility/VAT into separate lines — the received-basis branch bundled all three into one opaque figure, hiding the utility/VAT components entirely. Now both branches behave the same way: three plain-language lines ("Rent Received"/"Rent Invoiced", "Utility Received"/"Utility Invoiced", "VAT Received"/"VAT Invoiced"), chosen by the property's actual `commissionRecognitionBasis`. Pure relabel/redisplay — verified the redistributed total still sums to exactly what the old bundled figure equalled. Applies to both the PDF and the live workspace UI. |
| `6beee36` | Two UI requests against a real screenshot: (1) compacted the padding/margins across the live workspace's chrome (top filter bar, property info bar, 5 KPI footer tiles, recap lines) so more tenant rows fit on screen before scrolling — no information removed, no font sizes reduced further; (2) removed the Manager transfers / Total Income This Period / Deposits You Now Hold / Tenant credit balances recap block from the live workspace entirely — it duplicated what the printed PDF already shows in full, and was costing vertical space better spent on tenant rows. PDF template untouched; workspace-only. |

### Data-integrity finding surfaced along the way (not yet actioned)

`receiptNumber` and note numbers (e.g. `DN00037`) are **not unique** across
the database — confirmed collisions across unrelated tenants/companies
sharing the same displayed number, hit three separate times during Track D's
investigation (a query scoped only by number silently returned the wrong
document each time). Every fix above was verified by re-scoping queries to
`_id`/tenant instead. Worth a dedicated look: whether these are meant to be
unique per-business and a constraint is missing, or the display number was
never intended to be a lookup key and every caller needs auditing.

---

## Track C — Whole-system optimization audit (scan complete, **no implementation started**)

Four parallel agents each audited one slice of the codebase for performance
and code-quality issues. This is a scan only — scope and sequencing still need
to be agreed with the user before any of this is implemented.

### 🔴 High priority

**Security-adjacent / correctness**
- All of Track B originated here (backend controllers/routes audit).

**Duplication with bug-propagation risk** (same pattern flagged independently by 3 of 4 audits)
- `round2` reimplemented 15+ times across controllers *and* services, with two subtly different formulas in circulation — a real rounding-consistency risk on financial amounts. `utils/math.js` already exports a canonical version; only `financialReports.js` imports it.
- `resolveBusinessId`/`oid` duplicated across 8+ files — directly caused several Track B findings (one copy got the auth-priority order right, siblings didn't).
- `escapeRegExp` reimplemented in 3 service files instead of the shared `utils/escapeRegex.js`.
- Frontend: a prepayment-type-derivation algorithm (deriving Rent/Deposit/Utility prepayment options from invoice metadata) duplicated 4+ times: `AddReceipt.jsx`, `Receipts.jsx` (×3 separate copies), `LandlordStatementAllocations.jsx`.
- ~~7 near-identical `*ImportModal.jsx` components (~2,000 combined lines) differing only in parser function and column list.~~ **Closed — see Track C progress, item 4 part A.**

**Performance**
- Backend: sequential per-item `await`+`save()` loops in batch endpoints (`latePenalties.js` reversal batch) — should be `Promise.all`. (`tenantInvoices.js`'s equivalent, `deleteTenantInvoicesBatch`, is already fixed — see Track A/B.)
- Frontend: **none of `redux/apiCalls.js`'s list-fetch action creators check existing store state before refetching** (only `fetchCompanySettings` did this correctly). ~~Single biggest realistic network-traffic win identified.~~ **Fixed for the 7 files that actually had this pattern — see Track C progress, item 2.** `AddUnit.jsx` also duplicates the company-settings fetch with a raw axios call instead of reusing the cached selector — not yet addressed, unrelated to the redux refetch-check work.

### 🟠 Medium priority

**Backend**
- ~~`landlordStatementService.js`: 4,149 lines / 1 exported function~~ — **closed**, see Track C item 3 below. Decomposed via an accumulator-object pattern rather than a file split (its N+1/query correctness was independently verified clean before this work; this was purely a decomposition — the file itself stays one file, since its ~2,900-line body was one function with shared local state, not independent exports).
- `tenantInvoices.js: createTenantInvoiceRecord` — 586-line function mixing validation, account resolution, sequence generation, GL posting, and recompute in one body.
- `communicationService.js` (1,827 lines) and `statementPdfService.js` (1,281 lines) — large but multi-export, less severe than the above; opportunistic split candidates.
- A `business` vs `company` field-naming split across models: `Landlord`, `CompanySettings`, `User`, `AuditLog`, `TrialRequest`, `Zone` use `company`; nearly everything else uses `business`. Flagged as a standing copy-paste trap, not urgent — worth documenting per-model rather than mass-renaming.
- In-process, non-distributed caches with TTL (`chartAccountAggregationService.js`, `propertyAccountingService.js`) — fine for single-instance deployment; latent consistency gap only if horizontally scaled.

**Frontend**
- ~~`redux/apiCalls.js`: 3,331-line, ~230-action-creator God-file mixing every domain in the app.~~ **Fixed — see Track C progress, item 3.** (Turned out to be 3,389 lines / 281 action creators once counted precisely.)
- `DashboardLayout.jsx`: 2,034 lines, 5 largely-independent components (`DashboardLayout`, `HelpMegaPanel`, `ProfessionalDropdown`, `FinancialDropdown`, `TopToolbar` — the last alone ~1,430 lines) bundled into one file.
- `TenantStatement.jsx` (3,530 lines): `renderRentReviewsAndEscalations`/`renderBillingSchedule`/`renderStatement` are plain functions invoked as fake components — recompute derived arrays and recreate handler closures on every render of the parent, unlike the rest of the file's otherwise-consistent memoization.
- `ClientDetail.jsx` (1,899 lines): 55 `useState` calls in one component.
- `companySetup/CompanySetupPage.jsx` (4,357 lines) and `SystemSetup/CompanySettings.jsx` (3,451 lines) — both legitimately separate routes, both strong candidates to split per-settings-section.
- Several other 2,300+ line page files (`RentalInvoices.jsx`, `Receipts.jsx`, `Tenants.jsx`, `AddTenant.jsx`, `Landlord/Statements.jsx`) are already reasonably memoized internally — the issue there is pure file size, not runtime perf.
- `MilikTable`'s `React.memo` is effectively neutralized in most of its ~50 page consumers because `renderRow`/`renderActions`/etc. are passed as inline closures re-created every parent render. **Partially addressed — see Track C progress, item 4 part B** (the 2 consumers with a demonstrated cost fixed; the rest deliberately left as logged backlog, not ground through).
- ~8–9 pages hand-roll `StatusBadge`/`PaginationBar` despite the shared components already being used correctly in 37–90 other places.
- `Landlord/StatementsTable.jsx` duplicates `StatusBadge` logic locally instead of using the shared component with a custom map.

### 🟢 Low priority / cleanup

- **Dead code** (backend): 3 files already removed in commit `99c056b` (see Track A). `controllers/employee.js` — confirmed completely unrouted/unreferenced, left in place pending an explicit decision to remove (imports a non-existent `../models/Employee.js`, so it would crash if ever wired up).
- **Dead code** (frontend): `components/Dashboard/MainContent.jsx` and `TopNavbar.jsx` are 0-byte files; `components/Dashboard/Sidebar.jsx` is unused and duplicates `RecentActivity.jsx`.
- `LISTING_UI` imported but never used in 8 page files; several unused `react-icons/fa` imports scattered across ~10 files.
- No shared `DateRangeFilter` component exists despite ~42 files hand-rolling a from/to date-range picker.
- A handful of dashboard widgets (`CommunicationHub.jsx`, `AlertBanner.jsx`, `DashboardCard.jsx`) aren't `React.memo`-wrapped while their siblings are — inconsistent, minor.
- `recurringSchedule.js` (297 lines) hand-rolls calendar math (`daysInMonth`, `addMonths`, month-end clamping) from scratch despite `moment`/`moment-timezone` already being dependencies — DST/leap-year edge cases are a standing risk here; worth unit tests at minimum if not replaced.
- `CommunicationComposerModal.jsx`: an auto-preview effect's dependency array is missing `normalizedIds`, masked by a manual "Refresh Preview" button rather than fixed.
- No missing-index findings anywhere in the models audited (`TenantInvoice`, `RentPayment`, `FinancialLedgerEntry`, `LandlordStatement*`, `ChartOfAccount`, `Tenant`, `Unit`, `Lease`, `Property`, `JournalEntry`, `PropertyLedgerEntry`, `ProcessedStatement`, `Landlord`) — the prior optimization pass's indexing work held up.
- No table virtualization anywhere in the frontend (`react-window`/`react-virtualized` absent) — deliberately not flagged as urgent since the largest unpaginated tables are print-oriented financial reports where full-table rendering is likely intentional.

### Track C progress — ✅ fully closed (all 5 items done, 2026-09-18)

Agreed order (established before Track D's unplanned detour):

1. ✅ **`round2` consolidation — done.** Found 33 files with an independent
   local reimplementation (not the 15 originally estimated). 27 matched the
   canonical `utils/math.js` formula exactly, byte-for-byte — pure dedup,
   zero behavior change (`00b6fd2`). The other 6
   (`statementAllocations.js`, `budgets.js`, `fixedAssets.js`,
   `ledgerDiagnostics.js`, `taxRemittance.js`, `whtRemittance.js`) were
   missing `Number.EPSILON`, a genuinely different formula that silently
   under-rounds real financial amounts on floating-point boundary values
   (e.g. `1.005` → `1.00` instead of `1.01`) — a real, if narrow,
   rounding-correctness bug on tax/WHT remittances, budgets, fixed-asset
   depreciation, statement reallocation, and GL diagnostics, now fixed
   (`8954706`). Full suite: 28/28 files, 118/118 tests passing throughout.
2. ✅ **Redux refetch-check pattern — done.** Targeted grep across all 25
   redux files for the half-built shape (a field tracking last-loaded
   scope, written on success but never read before the next fetch) found
   exactly 7 targets, not ~30 — the other ~23 action-creator files have no
   such infrastructure at all, so there was nothing to wire up there.
   `propertyRedux`/`tenantsRedux`/`unitRedux` already had unused
   `loadedFor`/`loadedAt` state; `utilityRedux`/`leasesRedux`/
   `rentPaymentRedux` had the same via legacy `setXLoadMeta` actions;
   `landlordRedux` had none and was built fresh to match.

   A naive "skip if same business" cache would have been a real bug: many
   call sites fire the exact same plain `{business}` shape immediately
   after a mutation (e.g. `Tenants.jsx`'s `onSaved` handlers, a unit
   transfer) to show the fresh result. The skip-check only applies to the
   unfiltered, single-scope shape (filtered/paginated calls always bypass
   it), and every create/update/delete/confirm/sign/renew `.fulfilled`
   reducer resets the cache timestamp — so a mutation always forces a live
   refetch on the next call regardless of the 5s TTL. Also fixed a real
   pre-existing bug found along the way: `getRentPayments` stamped its
   cache unconditionally even on filtered fetches (unlike `getLeases`,
   which already guarded this correctly).

   Three commits, grouped by calling convention: `fac2471` (modern
   `createAsyncThunk` slices — property/tenants/units), `e3bf28e` (legacy
   dispatch-first-arg thunks in `apiCalls.js` — utilities/leases/rent
   payments, reading the `store` singleton directly since they aren't
   dispatched thunks themselves), `fec77c8` (`getLandlords`, built fresh).
   Lint clean on every touched line; full frontend build succeeded (no
   circular-import issue from importing `store` into `apiCalls.js` —
   verified store.js's reducer imports never touch `apiCalls.js`). No
   frontend test suite exists in this repo (no test script in
   `package.json`) — lint + build is the available verification.
3. ✅ **God-file decomposition (`landlordStatementService.js`, `redux/apiCalls.js`) — done.**
   - ✅ **`redux/apiCalls.js` — done.** Mapped domain boundaries before
     moving anything: which action creators cluster together, which
     private helpers are used across ≥2 domains (`extractList`,
     `resolveCompanyId`/`resolveLandlordIdFromProperty`, the `store`
     singleton, a `buildQuery`/`buildPropertyLedgerQuery` pair that turned
     out to be byte-identical duplicates), and confirmed every one of the
     80+ consumer files imports via the extensionless module path with
     named imports only — no deep-path or default imports anywhere, so a
     barrel re-export needed zero consumer-side changes. Split 3,389 lines
     / 281 action creators into 37 domain files (largest ~230 lines) plus
     `redux/apiCalls/shared.js` for the cross-domain helpers (the `store`
     import now has one single, auditable entry point instead of being
     scattered across whichever files happened to need caching), landing
     in 6 domain-grouped commits plus a final barrel-cutover commit —
     `a66e00a`, `4e2e836`, `c503696`, `8618a46`, `35a543c`, `854a9c6`,
     `c84b9c5`. Verified after every batch: function count reconciliation
     (never just trusted a summary — recounted exports per file and
     summed), a full grep of each removed reducer's action-creator names
     across the whole remaining file before deleting its import block, and
     lint + build with directly-captured exit codes. The final cutover
     diffed the complete 281-name set against the pre-split file
     name-by-name (not just by count) — 0 missing, 0 unexpected extras —
     and confirmed 0 export-name collisions across the 37 files (would
     otherwise break the `export *` barrel).
     Found two real pre-existing bugs along the way, both left exactly as
     found per scope (not this task's job to fix): `addUtilityToUnit`/
     `removeUtilityFromUnit` dispatch reducer actions that don't exist
     anywhere in the codebase (dead code, confirmed zero callers including
     via namespace-import indirection — flagged for item 5, not a live
     bug); and a self-inflicted one caught before it shipped — a
     marker-based text-removal script ate the `// ` prefix off a comment
     once, producing a hard parse error that a piped build command's exit
     code silently didn't surface (the pipe reported `tail`'s exit code,
     not the build's) — caught by eslint's independent parser instead,
     fixed, and every batch after that verified with directly-captured
     exit codes and an explicit post-removal corruption sweep before
     running lint at all.
   - ✅ **`landlordStatementService.js` — closed.** A different shape of
     problem than `apiCalls.js`: one 4,298-line exported function
     (`generateLandlordStatement`), not 281 independent exports, so the
     risk was in untangling shared local state, not drawing file
     boundaries. Scanned first, with no code moved until the scan was
     reported and approved: walked the real control flow (not assumed
     phase names), listed every variable crossing each candidate
     boundary, and cross-referenced Track D's `c355950` fix (the K1/K2/
     S3/S5 Bal B/F/C/F root-cause fix) against the proposed split —
     it touched 4 separate sub-loops inside what would have been one
     "phase," direct evidence that splitting the mega-loop by loop would
     have made that exact fix harder, not easier. That finding ruled out
     a per-loop split and justified an accumulator-object factory
     (`createStatementAccumulator`) instead — the ~20 variables/closures
     shared across the loop (`ensureRow`, `pushEntry`, the inclusion-gate
     closures, deposit-memo handling, the running collection totals,
     etc.) became explicit, greppable methods/fields on one object
     instead of implicit closure captures.
     14 commits: `1f9285b`, `ea0d645`, `d351ddf`, `a917069`, `cb04e5c`,
     `5d3421d`, `e5e8298`, `4704198`, `7cb3460`, `b6786da`, `f6111b1`,
     `ef7047c`, `c363a2d`, `5533891`. Process was stricter than any prior
     file this session: each accumulator method converted one at a time,
     the 22-test suite run and its literal pass count quoted after every
     single extraction (never batched), and for the three call sites
     directly inside `c355950`'s fix (steps 9-11) an additional
     line-by-line `diff` of the extracted method against the original
     inline block before each commit — not just a passing test suite,
     since a 22-fixture suite can't guarantee a copy-paste didn't drop a
     condition nothing in those fixtures happens to hit.
     Two points flagged as fragile in the scan were investigated (not
     resolved silently) once actually holding the code: (1) `ensureRow`'s
     reach into output assembly, far past any phase boundary — checked
     whether it could read from the already-materialized `tenantRows`
     instead; concluded no, since `ensureRow` encapsulates ID
     normalization and terminated-tenant handling that a direct lookup
     would have to unsafely reimplement, and the refactor already turned
     the reach from implicit closure capture into an explicit
     `accumulator.` call, which was the actual goal. (2) A planned "Phase
     6" extraction (derived summary figures) was scanned in full and
     found to have a 20+-variable dependency surface scattered across the
     function — exactly the "bad boundary" signal the scan methodology
     itself warns about — so it was deliberately left inline rather than
     forced into a function with a 20-parameter signature. The dual raw-
     ledger pass (`getReceiptRentLedgerCash`) was left untouched per
     explicit instruction, full stop.
     Closed out with a structural sanity check (0 bare references to any
     of the ~19 converted closure names anywhere outside the accumulator
     object) and a programmatic pre/post comparison — `generateLandlord
     Statement` run against real production data at this work's start
     commit (`4e34685`) and at HEAD, for 4 scenarios (multi-unit
     consolidation, self-managed raw ledger, a reversed invoice inside
     the period, a reversed debit note inside the period — the last two
     covering the exact `c355950` condition) — with every output field
     deep-diffed. 0 substantive differences in any of the 4; the only
     diffs were freshly-random entry `_id`s and `generatedAt` timestamps,
     both expected to differ on every call regardless of code changes.
4. ✅ **`*ImportModal.jsx` consolidation + `MilikTable` memoization fix — done.**
   - ✅ **Part A — `*ImportModal.jsx` consolidation.** Scanned all 7 files
     side by side before touching anything: mapped what was genuinely
     identical structure (upload/parse/preview/errors/footer — ~70% of
     each file) versus incidentally different per type (preview columns,
     dynamic terminology, template-download placement, accept types). Key
     finding: `SaleImportModal.jsx` was already the proven config-driven
     pattern (in production use by both `SaleBuyers.jsx` and
     `SaleListings.jsx`) — not something to design from scratch, just
     generalize and migrate the other 6 onto it. Also caught, before
     writing a shared component, that Products' backend uses a completely
     different response contract (`{created, skipped, errors}` vs.
     everyone else's `{successful, failed}`) — a silent-data-loss risk
     (import failures rendering as 0 for that one type) that a naive
     shared component would have hidden.
     7 commits: `5e2c80a` (generalize `SaleImportModal` → `ImportModal`),
     `d56a89b` (Property), `c8fd100` (Products — the divergent-shape case,
     deliberately migrated second to validate the design early),
     `d50ae14` (Landlord), `bab3951` (Units), `00383b9` (Tenants),
     `a9595e7` (InvoiceNotes, last — lowest risk). 6 bespoke modal files
     deleted. `ImportModal`'s contract: `onImport` must resolve to
     `{successful, failed}` — shape normalization for backends that nest
     or diverge happens in each page's own `onImport` wrapper, never in
     the shared component, so it never has to guess a backend's shape.
     Per-type overrides (`accept`, `maxWidthClass`, `zIndexClass`,
     `submitColorClass`, `getErrorRowLabel`/`getFailureRowLabel`) all
     default to Sale's original values — deliberate differences (Products'
     `z-[130]` matching `components/common/Modal.jsx`; InvoiceNotes'
     orange submit button) preserved as configurable props rather than
     normalized away, confirmed field-by-field against each type's real
     backend controller and parse function before writing the migration,
     never assumed. Template download consolidated into the modal for all
     7 types (previously scattered across page toolbars for 4 of them).
     Verification split by risk: since this is a write path with no test
     suite, the actual "Import" submission was never clicked against the
     live database for any of the 7 — the read path (upload → parse →
     preview → validation errors) was verified through the real running
     app via Playwright with a generated test file per type, and the write
     path was verified by reading the real backend controller's response
     shape directly and confirming the page's wrapper normalizes it
     correctly.
   - ✅ **Part B — `MilikTable` memoization.** Scanned all ~49 consumers:
     confirmed nearly all pass `renderRow` (and usually several more of
     `renderActions`/`renderExpanded`/`groupBy`/`onRowClick`/`isSelected`/
     `rowClassName`/`onCheckAll`/`isChecked`/`onCheckRow`/`onSort`) as
     inline arrow functions, defeating `MilikTable`'s `React.memo`. Also
     found `columns` is commonly an inline array literal at call sites too
     — fixing only the callback props while leaving `columns` unstable
     would make a fix a no-op. Explicitly scoped down rather than treating
     all 49 as in-scope: fixed only the 2 consumers with a *demonstrated*
     cost — `PmsMpesaNotifications.jsx` (`a61ad0d`) and
     `CoopCollections.jsx` (`c330527`), both of which poll every 30s,
     forcing a full table re-render on every tick regardless of user
     activity, on top of every unrelated re-render (e.g. every filter-
     input keystroke) before the fix. `CoopCollections.jsx` additionally
     needed `handleDelete`/`handleUnignore` wrapped in their own
     `useCallback`s first — they were plain functions recreated every
     render, so memoizing `renderActions` alone would have been a no-op.
     Real per-company row counts were then checked for the 3 conditional
     candidates (`Tenants.jsx`: 174 largest-company / 533 total;
     `RentalInvoices.jsx`: 612 / 1,584; `Receipts.jsx`: 290 / 613) —
     all in the hundreds, capped to ~50 rendered DOM rows per page by
     existing pagination regardless of total, well short of the two
     genuinely hot (polling-driven) paths already fixed. Decision: none
     of the three added to scope. The remaining ~44 consumers (plus these
     3) are **left as logged backlog** — deliberately not ground through,
     per this initiative's own stated philosophy against speculative
     optimization with no test suite and no evidence of user-facing lag.
     Verification: since Part B is pure rendering (no writes), browser-
     automation click-throughs against the real app were used freely
     (unlike Part A) — `PmsMpesaNotifications.jsx` verified against 50
     real, varied rows from a live company (found via a direct read-only
     DB query after the default test company turned out to have zero
     matching records); `CoopCollections.jsx` verified structurally only
     (zero `CoopCollection` records exist anywhere in the database —
     confirmed before assuming, not guessed), since its logic is
     structurally identical to the already-proven pattern.
5. ✅ **Low-priority cleanup batch — done.**
   - ✅ **Unused `LISTING_UI` import — done (`46d51f2`).** Confirmed via
     grep before touching anything: 10 files (not the originally-estimated
     8) import `LISTING_UI` from `utils/listingPageUtils` with exactly one
     occurrence each (the import line, never referenced again). Where the
     same import line also pulled in `normalizeUppercaseInput`/
     `toListingCaps`, verified those are genuinely used (2+ occurrences)
     before leaving them — only `LISTING_UI` removed.
   - ✅ **Unused `react-icons/fa` imports — already resolved, nothing to
     do.** Checked via eslint's own `no-unused-vars` output across the
     full `src` tree rather than assuming the original "~8-9 files"
     estimate still held: zero unused `Fa*` icon imports found. Apparently
     already fixed as a side effect of the `FaFileDownload`/`FaDownload`
     removals during Track C item 4's toolbar-button cleanups.
   - ✅ **`controllers/employee.js` removal — done (`9d705ad`).**
     Re-confirmed independently (not just trusting this doc): zero
     references anywhere in the codebase, and it imports
     `../models/Employee.js`, which doesn't exist — would crash on import
     if ever wired up. The modern `modules/hr/*` fully superseded it. The
     local permission system blocked `git rm` twice as "Irreversible
     Local Destruction" when attempted proactively; completed once the
     user explicitly instructed the exact command to run.
   - ❌ **`recurringSchedule.js` → `moment`/`moment-timezone` swap —
     investigated, declined.** Read the full file before proposing any
     change, per this session's standing practice. The doc's stated
     rationale doesn't hold up under inspection: this is a Kenya-only app
     (Africa/Nairobi, UTC+3 year-round, no DST transitions ever — the
     cited DST risk doesn't apply to this business's actual usage);
     `daysInMonth` uses the standard `new Date(y, m+1, 0).getDate()`
     idiom, already leap-year-correct; and `addMonths` specifically
     avoids the classic "Jan 31 + 1 month → Mar 3" overflow bug via
     `setDate(1)` before `setMonth()` — more careful than `moment`'s own
     default `.add(1, 'month')` arithmetic, which has its own well-known
     end-of-month surprises. Swapping would trade already-correct logic
     for a new dependency with real regression risk, on code that drives
     recurring billing schedules with no test suite to catch a subtle
     date-math bug. Declined by explicit user decision rather than
     silently left alone or silently done.

**Do not implement any of the above unilaterally** — still gated on the
user's go-ahead per item, consistent with how every fix in this document was
actually authorized.

---

## Track E — CarWash module: correctness audit + fixes (2026-09-19) — CLOSED

Started as the first module of a "module at a time" whole-system
correctness-then-optimization pass, per explicit user instruction, following
Track C's full closure. CarWash chosen first as the largest module without a
dedicated correctness pass (Track B's earlier sweep was security-only).

**Audit.** 3 parallel read-only agents split by domain (money-movement /
jobs-commissions / loyalty-reports), each instructed to trace and confirm
every finding against actual code, not guess from function names. 16 findings
total: 2 CRITICAL, 6 HIGH, 5 MEDIUM, 3 LOW. No CarWash test suite exists
(confirmed via `find modules/carwash -name "*.test.js"` — empty), so fix
verification relied on `node --check`, matching established in-file patterns
exactly, and personal line-by-line diff review before committing — no lint
config/script exists for the `MilikApi` backend at all (checked and confirmed
by every fix agent independently).

**Fixes.** 4 parallel fix agents, split by exclusive file ownership (not the
original 3 audit domains, since 2 files were touched by findings from
different domains) to avoid worktree-merge conflicts. Agents fixed only their
assigned findings and did not commit; each diff was independently reviewed
and traced against the original finding before being applied to `main`.

| Commit | Group | Findings closed |
|---|---|---|
| `2845f30` | A — `mpesaCallbackController.js`, `creditAccountsController.js` | 1 (CRITICAL, M-Pesa double-credit race), 2 (HIGH, non-atomic payment balance write), 5 (HIGH, STK overpayment uncapped), 9 (MEDIUM, fire-and-forget overpayment routing), 10 (MEDIUM, STK missing E11000 handling) |
| `5cb7ea7` | B — `commissionsController.js`, `carwashAccountingService.js` | 3 (HIGH, commission reversal never persisted — silent GL gap), 4 (HIGH, failed payout orphaned savings/damage deductions) |
| `075e4cf` | C — `jobsController.js`, `paymentsController.js`, `loyaltyController.js`, `commissionService.js` | 7 (HIGH, outstanding-balance tile netted across customers), 11 (MEDIUM, tax rounding bypassed `round2` ×2), 12 (MEDIUM, payment-status comparisons lacked tolerance ×2 files), 13 (MEDIUM, `createJob` status invariant — see caveat below), 14 (LOW, unguarded `$inc` on topup reversal), 15 (HIGH, reward-line price/validity client-trusted) |
| `fffda50` | D — `reportsController.js` | 6 (CRITICAL, status-bucket missing `drying`/`ready` keys), 8 (HIGH, `staffReport` fanout double-count via `$lookup`+`$unwind`) |

**Caveat on finding 13.** The fix (reject `status: "paid"` at job creation)
is currently unreachable: the file's local `JOB_STATUSES` allow-list (line
24) excludes `"paid"` entirely, so a requested status of `"paid"` already
silently falls back to `"waiting"` before the new check runs — it exactly
mirrors an identical pre-existing dead check already in `updateJob` (gated
the same way). The actual bug is a separate divergence between this local
enum and `CarWashJob.js`'s canonical status enum (which does include
`"paid"`), flagged as an aside in the original audit but never one of the 16
assigned findings — not fixed here, left as a known follow-up.

**Not yet done:** no in-browser/manual verification pass on these fixes —
none is currently planned given the complete absence of a test suite; noting
this explicitly rather than claiming coverage that doesn't exist.

Next module in the "module at a time" sequence not yet decided with the user.

---

## Track F — CarWash module: full performance pass (2026-09-19) — CLOSED

Ran immediately after Track E, per explicit user instruction to do the
module's optimization "100% fully" with no backlog left — unlike Track C,
which deliberately left most of its `MilikTable`/file-size findings as
logged backlog, every finding from this audit was fixed.

**Audit.** 6 parallel read-only agents (3 backend domains, 3 frontend
domains) covering all 65 backend files and 31 frontend files in the module.
62 real findings after discarding 2 stale ones (see below): N+1 queries,
missing/mismatched indexes, unbatched independent awaits, missing `.lean()`,
unbounded list endpoints, React-memo-defeating inline props, missing
memoization, unbounded polling, and a few incidental correctness bugs found
along the way (a dead rollback-on-failure branch, a crash on an unimported
hook).

**Infrastructure issue found mid-pass.** All 9 fix-agent worktrees (and, in
retrospect, the earlier 3 re-run audit agents) were rooted at a stale base
commit (`ad80dba`) that predated every Track E commit — not something any
individual agent did wrong, a session-wide worktree-provisioning issue. This
was caught before any backend commit landed: one agent's diff appeared to
*revert* Track E's atomic-`$inc` race fix in `recordAccountPayment`, which
turned out to be a stale-base artifact, not a real revert. Every backend fix
group was therefore reconciled via `git apply --3way` (not applied as a raw
patch) against current `main`, and every resulting conflict was resolved by
hand — verified line by line, not just "no conflict markers." Frontend
groups didn't need 3-way reconciliation (no file overlap with Track E's
backend-only changes) but were still diffed against their true base rather
than assumed clean.

**Fixes — backend (5 commits, by exclusive file ownership):**

| Commit | Scope |
|---|---|
| `a0bb01b` | Credit accounts: batched FIFO payment writes (insertMany/bulkWrite), `computeAccountBalance` no longer re-fetches, pagination on 2 unbounded endpoints, `repairCreditLedgers` query-level diff, new index |
| `47de947` | Commission accounting: hoisted per-commission ledger aggregation out of the accrual loop, cached resolved system accounts, batched per-staff lookups, collapsed savings-balance aggregations, 2 new indexes |
| `29ab6b3` | Reports/loyalty/admin: missing commission index, cached loyalty-program lookup in the backfill loop, batched cashbook-per-method lookups, `.lean()` additions |
| `0beb026` | Jobs/payments/commissions: dropped 4 unindexed sort tiebreaks, batched independent lookups, new index, **fixed a dead rollback** (`createCommissionPayout`'s catch block referenced a `try`-scoped variable, so its revert-to-payable logic could never run) |
| `63d67f9` | M-Pesa callbacks: batched bulk-upload lookups (down from ~8 round trips/row), replaced per-job `refreshJobPaymentStatus` calls with bulkWrite, deferred non-critical SMS to fire-and-forget (payment/ledger/overpayment work stays awaited) |

**Fixes — frontend (1 commit + 1 follow-up fix, 24 files):**

| Commit | Scope |
|---|---|
| `69bb55f` | All 4 frontend groups (dashboard/jobs/reports, chart-of-accounts/commissions, accounts/payments, customers/loyalty/shell) landed together in one commit — a scoping mistake in how the changes were staged, not a review shortcut; see note below. Covers: memoized service-option computation in `CarWashAddJob`, isolated the 1s clock tick in `CarWashQueueDisplay`, memoized card components and status grouping in `CarWashWashboard`/`CarWashJobs`, extracted the commission-payout modal into its own component (was re-rendering the full table per keystroke), fixed `CarWashShell`'s uncached `getActiveBranchId()` call (ran on every state change of every CarWash page), media-query-gated the mobile/desktop duplicate-render pattern on 4 pages, converted `CarWashExpenses`/`CarWashMpesaNotifications`/`CarWashCommissionPayouts` to react-query, and **fixed the `CarWashStaff.jsx` crash** (`useCallback` used but not imported — broke wallet-drawer expand) |
| `368508f` | Fixed a JSX syntax error the media-query gate introduced in `CarWashDeposits.jsx` (a trailing comment landed outside its parent's children) — caught via `esbuild`, not by the build agent itself (see note below) |

**What went wrong with frontend verification, and how it was caught anyway.**
All 4 frontend fix agents were mid-build-verification when a session-wide
rate limit killed them before they could report. Their file edits survived
in their worktrees regardless (agents don't roll back on API failure), so
the diffs were recovered and reconciled the same way as the backend groups.
Because the agents never got to report their own `node --check`-equivalent,
verification was done independently after the fact: `esbuild` parse-checked
all 24 files (caught the one real syntax bug above), a full `npm run build`
was run clean end to end, and `eslint` was diffed against a clean pre-change
baseline (a throwaway worktree at the same commit) file by file to separate
genuinely new issues from this codebase's large pre-existing lint backlog —
every new lint entry traced back to either an intentional, correct
consequence of the requested fix (e.g. React Compiler declining to
auto-optimize a `useCallback` whose dependency was deliberately narrowed to
`.mutate` instead of the whole mutation object, per the fix's own
correctness goal) or convergence onto an already-established codebase
pattern, not a new defect.

Not yet done: no in-browser click-through of the frontend changes (consistent
with Track E's precedent — no test suite, no established UI-verification
step for this module yet).

---

## Track G — PropertySale module: correctness pass (2026-09-19) — CLOSED

Second module in the "module at a time" sequence. Correctness only; the
performance pass for this module is a separate, later step and has NOT been
done. (POS sales in the Inventory module are unrelated despite the name and
were excluded.)

**Audit.** 6 read-only agents (3 backend, 3 frontend) over 28 backend and 28
frontend files. No PropertySale test suite exists, so verification was
`node --check`/esbuild parse checks, an import of all 12 route modules, a full
`npm run build`, and reading every diff before merging. Fix agents were told to
verify each finding against live code and report any that weren't real; the
agent-scope bug was also spot-checked by hand before fixing.

**Fixes (7 commits, by exclusive file ownership):**

| Commit | Scope |
|---|---|
| `3736b17` | Payments/schedule: void and GL-affecting edits blocked on closed/cancelled deals (voiding after close permanently corrupted Revenue and Buyer Deposit Held, because the deposit-transfer/forfeit GL entries have no reversal path); post-insert overpayment re-check for concurrent submits; remaining-balance check on amount edits; schedule renumbering/total fix; business-wide overdue refresh; 3 indexes |
| `26ca010` | Agent scoping (below), activities cross-tenant refs, reports, upload filters |
| `91d6600` | Deals/commissions: createDeal no longer mutates an arbitrary offer by raw id (cross-tenant); deal creation compensates on failure instead of leaving orphans; commission stats scoped and ObjectId-cast; closeDeal/updateDeal reconciliation; round2 for WHT/commission |
| `c5c9052` | Offers/listings/leads/import: accepting an offer is now exclusive (new server-managed `SaleListing.acceptedOffer`) and parks the listing as `reserved`, never `under_contract`; listing status can't be set via generic create/update; getPipeline ObjectId cast (the dashboard showed zeros for every tenant); bulk-import validation, isolated insertMany and duplicate skipping; race-safe lead conversion |
| `00f0684` | Agent performance pages fetch all pages instead of silently truncating at 200 |
| `9178e6d` | Commission statement shows Gross/WHT/Net; VOID receipts; stale deal panel; printed monthly commissions total |
| `c763234` | Offer print stored XSS; funnel "Proposal Sent" row; stale-cache invalidations; cross-company placeholder flash; email placeholders |

**Behavior changes users will notice after deploy**
- **Agent scoping now actually applies.** The old middleware read `req.user._id`
  but the login JWT carries `id`, so it never scoped anyone; it also ignored the
  header-based business id and failed open on errors. Users linked to a
  SaleAgent now see only their own leads/deals/commissions on list pages.
  Admins/managers (no agent link) are unchanged.
- Payments on closed/cancelled deals cannot be voided or have amount/date/
  cashbook edited; the deal workflow for correcting them does not exist yet.
- Bulk import skips duplicates and only accepts available/withdrawn listing
  statuses.
- Uploads with a rejected file type now fail with a 400 instead of silently
  saving the rest.

**Known gaps, deliberately not fixed**
- Agent scoping covers the list endpoints and commission get/status, but
  `getDeal`, `getLead` and the deal/lead mutations are still unscoped by agent.
- An agent-scoped user with the process permission can approve/pay their own
  commissions.
- `updateDeal` price changes don't recompute the pending commission amount.
- `updateLead` resets omitted fields on partial updates (sanitizer defaults);
  `updateListing` can still overwrite `images`.
- Deal statement/summary pages sum only the first 200 payments.
- `SaleDeals.jsx` email vars still omit titleTransferDate/stampDuty/
  propertySize/propertyCounty, so those placeholders go out literally.
- Bulk import is not safe against two simultaneous uploads (no unique indexes on
  the natural keys); `setSchedule` is still delete-then-insert.
- No in-browser or database-level testing of any of this.

**Process notes.** Parallel agent batches hit session rate limits again, so
agent use is now capped (see project memory). Worktree agents are still rooted
at a stale base commit, so every diff was applied with `git apply --3way`. One
audit finding was backwards (which side of the monthly-detail commissions key was
wrong) and one fix agent found an extra root cause (the JWT `id` field); both
were confirmed against the code before merging.

---

## Track H — PropertySale module: performance pass (2026-09-20) — CLOSED

Run with at most 2 agents at a time and no worktrees (agents edited the main
checkout; I reviewed and committed each batch myself). Audits found no per-row
awaits in the backend and no polling in the frontend; the cost was elsewhere.

**Backend (`2c46b85`, `72ff51a`)**
- Indexes: `{business,createdAt}` on deals/listings/commissions/leads/agents
  (the existing `{business,status,createdAt}` can't serve an unfiltered
  newest-first sort, so the dashboard's recent deals and every default list
  sorted the tenant's whole collection in memory), plus deal date windows,
  commission `{business,status,updatedAt}` and payment `{business,status,paymentDate}`.
- `getSalesReport` now buckets by month on the server (`$bucket`, same local-time
  month boundaries) instead of fetching a year of rows and filtering 72 times.
- `getCashFlowForecast` computes bucket totals with one aggregate and caps
  listed items per bucket (`hasMore` added).
- New `GET /sale/reports/agents-performance` and `GET /sale/schedule/summary`
  (one aggregate each); `/sale/schedule/overdue` accepts `limit` and returns a
  real total; `/sale/schedule/all` clamps limit to 200.
- Smaller: no duplicate SaleAgent lookup for non-agents, agent deal counts only
  for the page's agents, deal lists skip `documents`, `createDealFromOffer`
  drops a re-fetch, `deleteDeal` also deletes its schedule rows.

**Frontend (`8a1590c`, `f7b9298`)**
- The 8 big table pages (Deals, Leads, Listings, Offers, Payments, Commissions,
  Buyers, Agents) kept every modal's form state in the page root, so each
  keystroke re-rendered the whole table. Modals are now their own components,
  renderers are hoisted/memoized, hand-rolled tables got memoized rows.
- Agent performance, schedule header totals and the dashboard overdue banner use
  the new endpoints instead of fetching hundreds of populated rows.
- Cache fixes: page-reset effects moved into handlers (restored tab pages no
  longer fetch twice), business-scoped placeholders, ref-list key collisions
  split, `limit: 500` (server caps at 200) set to 200, raw-effect report/settings
  pages moved to react-query, more complete invalidations after deal/buyer/lead
  changes, xlsx loaded on click.
- Also fixed on the way: print windows in the reports/monthly/agent pages now
  escape output like the offer print, and SMS from a lead works again (it was
  calling the SMS modal with an old prop API and sending an empty body).

**Not done / caveats:** per-tab lazy loading of the Buyers/Deals detail requests;
`$text` indexes still aren't business-prefixed (replacing them risks an index
build error); no browser or database testing, and the new aggregates were only
checked against mocked results, so compare the sales report and agent
performance figures on a real tenant after deploy. Doc-upload draft text in
Deals/Buyers now clears when the panel closes.

---

## PropertySale gap closure (2026-09-20)

Closed the "known gaps" from Track G after the first local testing round, which
also found a real bug (lead-to-buyer conversion failed for "social media" and
"cold call" leads: the buyer model's source list was shorter than the lead's).

- Lead/buyer source and listing property type are free-form (Sale Settings lets
  admins add their own; the old fixed lists rejected them). Lead status stays
  validated: the built-in statuses plus the business's own pipeline stage names,
  and the funnel now shows leads in custom stages as "Custom stages".
- Agent-linked users are scoped on every by-id deal and lead route, not just the
  lists: they can only create deals/leads for themselves, cannot reassign, and
  the pipeline counts only their leads. They can no longer approve/pay their
  own commissions.
- Changing a deal's price recalculates its pending commission when it was a
  percentage derived from the old price (flat amounts, overrides and
  approved/paid commissions are left alone).
- Partial lead updates no longer wipe unsent fields; listing edits can't
  overwrite images; `setSchedule` restores the old schedule if the insert
  fails; bulk imports are serialized per business; deal statement/summary load
  every payment page; deal email preview shows the four placeholders that were
  missing.

**Agent visibility setting (2026-09-20).** New per-company switch in Sale Settings → Access →
Agent Visibility (`SaleSettings.agentVisibility`, `own` default | `all`, `PUT /sale/settings/agent-visibility`).
Applies to users linked to a SaleAgent; managers/admins are never scoped. In `own` mode agents see only their
own leads, offers, deals, payments, installments, activities (their own plus those on their leads/deals),
commissions, and the dashboard/report/funnel/cash-flow figures; listings and buyers stay shared. In both modes
agents cannot approve/pay/reverse their own commission and cannot reassign deals/leads. The mode is cached 30s
per business (cleared when the setting changes).

**Leftovers closed (2026-09-20).**
- Bulk import now accepts property types and sources from the built-in lists plus the business's active Sale Settings entries (case-insensitive; stored as lowercase / underscored like the forms).
- Buyers panel loads Payments and Log only when their tab is opened (Offers/Deals stay eager for the header counts).
- The four PropertySale text indexes (agents, buyers, leads, listings) are now `business`-prefixed. **Deploy step:** run `node scripts/migrateSaleTextIndexes.js` once against production (drops the old text index and rebuilds; search on each collection is briefly unavailable, so run at a quiet time). Idempotent. If the new code starts first, autoIndex can't create the second text index and the old one keeps working, so nothing breaks, it just isn't prefixed until the script runs.

**Still open:** the import lock is in-memory (fine on one API server; needs a DB-backed lock before a second server is added, along with any timer-driven jobs and local-disk uploads); Deals detail is one continuous panel (not tabs), so its four requests stay eager; none of this has been exercised in a browser.

---

## PropertySale projects and units (2026-09-20)

Companies can now sell items grouped into projects (plots in an estate, flats in a development) and track how each
project is selling. **A unit is an ordinary listing that belongs to a project** (`SaleListing.project`, `unitNumber`,
`block`), so offers, deals, payments, commissions and GL posting are untouched and standalone listings keep working.

- **Backend:** `SaleProject` model; `/api/sale/projects` (list with unit counts, detail with derived performance:
  sell-through, booked / collected / outstanding, price realisation, days to sell, monthly pace, per-agent results;
  generate units in bulk, group existing listings, bulk price change on available units only, apply project details to
  unsold units, detach a unit, archive, delete). Uses the `sale-listings` permission. Unit numbers are unique per project
  (partial unique index, standalone listings exempt). `GET /sale/listings` accepts `project=any|none`, `projectId`, `block`.
  Money figures follow the agent visibility setting; unit counts stay shared like listings.
- **Switch:** Sale Settings -> Selling Mode (`SaleSettings.useProjects`, default off) shows the Projects and Units pages;
  when on, the Listings page still lists everything (units included, with a Project / Unit column and an
  "All / Standalone only / In projects" filter). Turning it off only hides pages.
- **Client:** Projects list, Project page (unit grid, performance tab, generate / bulk price / add existing modals),
  Units page, shared `SaleListingFormModal`. Wording comes from the company terminology setting (`saleProject`, `saleUnit`, ...).
- **Tests:** `projectsController.test.js` (11 integration tests on an in-memory Mongo).
- **Deploy:** no migration. The new listing indexes build automatically on startup.
- **Photos (shared with listings):** projects have photos (`SaleProject.images`, same upload pipeline and folder as listing
  photos; `POST/DELETE /sale/projects/:id/images`). The photo logic is shared: `useSalePhotoDraft` + `SalePhotosField` (forms),
  `SalePhotoGallery` (detail panels + lightbox). The Projects list has the same table + detail panel as Listings.
- **Project agent (inherited):** a project can have a default agent (`SaleProject.assignedAgent`, must be an active agent of the
  company). A unit with no agent of its own inherits it; setting an agent on the unit overrides it. The unit's own
  `assignedAgent` is never rewritten: reads add `effectiveAgent` and `agentInherited` (`services/listingAgent.js`), and the
  listings agent filter also matches inherited units. Informational only: offers, deals and commissions use their own agent.
- **Not done / open:** one deal covers one unit (a buyer taking several units gets several deals); the "view offers" link on a unit is not
  filtered; not exercised in a browser.

## PropertySale terminology (2026-09-20)

Companies can rename what they sell in Company Settings -> System -> Terminology (keys `saleModule`, `saleListing(s)`,
`saleProject(s)`, `saleUnit(s)`, `saleBuyer(s)`, `saleLead(s)`, `saleOffer(s)`, `saleDeal(s)`, `saleAgent(s)`; same
`companySettings.terminology` map and `useTerm` hook as the PMS words; five sales presets). Display only: API, database and
permission names never change. Every Sales page, its print/PDF sheets, toasts and confirm messages use the words, plus the module
name in the workspace tab bar, start menu and module chooser. Defaults read as before, with small exceptions: the deals tables'
"Property" column now says the listing word, and the dashboard quick link "Sale Listings" says "Listings". Compound labels ("Sales
Agent", "Sale Deals") keep their prefix only while the term is the default (`prefixedTerm`).

Deliberately not renamed: GL account names, stored negotiation notes, SMS/email template bodies and their `{token}` names, the
lead-source value "agent", the marketing pages, and the admin screens (module picker, roles, access matrix), which use the product
name. Server-side error messages stay generic.

## PropertySale custom fields per item type (2026-09-21)

A property type (Company Settings -> Property Sales -> Property Types) can define up to 20 extra fields (text, number, list
of choices, date, yes/no; each optionally required) and leave out standard fields (size, location, title deed, amenities). A
"vehicle template" fills registration, make, model, year, mileage, engine, fuel, transmission and colour. Values live on
`SaleListing.attributes` ({ fieldKey: value }); field keys are stable, so renaming a label keeps stored values.

- **Validation** (`services/listingAttributes.js`, pure): on create/update only defined keys are kept, values are coerced to
  the field kind, a list value must be one of its choices, required fields must be filled. Changing a listing's type without
  sending values clears them. Generated units may share values (required not enforced for a batch). Unknown types define none.
- **Screens:** the listing/unit form asks for the type's fields and hides the standard ones it leaves out; the Listings and
  Units detail panels and the print sheet show them (and skip hidden standard fields).
- **Not covered:** bulk import (Excel) does not read custom fields; the "Generate units" modal has no UI for shared values
  (the API accepts `attributes`); custom fields are not searchable or reportable; hiding a standard field is a form/print
  choice only, existing values stay stored.
- **Also this pass:** the Units page panel is now the same shared panel as Listings (photos, print, edit); a new offer
  pre-fills its agent from the chosen item (own or project agent, if active); terminology presets now really clear words
  (the panel used to omit blank words and the server only changes words it receives), and a renamed singular gets a
  regular plural automatically.

*Last updated: 2026-09-20 (Track H closed — PropertySale performance pass, see above). Track G note: PropertySale correctness pass, see above. Maintained alongside the work it describes — update Track A/B/D as commits land; update Track C/E/F/G as items are actioned.*
