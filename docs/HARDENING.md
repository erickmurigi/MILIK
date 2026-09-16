# Hardening & Optimization Status

Living status document for the security hardening and system optimization work
started 2026-09-12/13. Four tracks: bug fixes landed on `main` (Track A), the
security hotfix (Track B, **merged and deployed**), an unplanned second wave
of landlord-statement bug fixes found via live user testing (Track D), and
the whole-codebase optimization audit still awaiting its scoping decision
(Track C — **not started**, see below).

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
- 7 near-identical `*ImportModal.jsx` components (~2,000 combined lines) differing only in parser function and column list.

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
- `MilikTable`'s `React.memo` is effectively neutralized in most of its ~50 page consumers because `renderRow`/`renderActions`/etc. are passed as inline closures re-created every parent render.
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

### Track C progress

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
4. `*ImportModal.jsx` consolidation + `MilikTable` memoization fix. **Not started.**
5. Low-priority cleanup batch (`controllers/employee.js` removal, `moment`
   for `recurringSchedule.js`, unused imports) — no urgency, batch whenever.
   **Not started.**

**Do not implement any of the above unilaterally** — still gated on the
user's go-ahead per item, consistent with how every fix in this document was
actually authorized.

---

*Last updated: 2026-09-16 (Track C item 3 fully closed — both `redux/apiCalls.js` and `landlordStatementService.js` decompositions done). Maintained alongside the work it describes — update Track A/B/D as commits land; update Track C as items are actioned.*
