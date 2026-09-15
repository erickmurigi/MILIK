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

## Track D — Property Performance Statement bug fixes (unplanned, user-reported)

Not part of the original plan — surfaced through the user actively using the
statement pages in production and cross-checking numbers against other
reports. All committed to `main`, tests green throughout.

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
- Frontend: **none of `redux/apiCalls.js`'s ~30 list-fetch action creators check existing store state before refetching** (only `fetchCompanySettings` does this correctly). Single biggest realistic network-traffic win identified. Hits the app's most-opened forms directly: `AddProperties`/`EditProperties`/`AddUnit` refetch landlords/properties/units unconditionally on every open; `AddUnit.jsx` also duplicates the company-settings fetch with a raw axios call instead of reusing the cached selector.

### 🟠 Medium priority

**Backend**
- `landlordStatementService.js`: 4,149 lines / 1 exported function — biggest single-file maintainability liability in the backend (its N+1/query correctness was independently verified clean, so this is purely a decomposition candidate, e.g. split into `recognitionDates.js`, `receiptAggregation.js`, `depositHandling.js`, `adjustments.js`).
- `tenantInvoices.js: createTenantInvoiceRecord` — 586-line function mixing validation, account resolution, sequence generation, GL posting, and recompute in one body.
- `communicationService.js` (1,827 lines) and `statementPdfService.js` (1,281 lines) — large but multi-export, less severe than the above; opportunistic split candidates.
- A `business` vs `company` field-naming split across models: `Landlord`, `CompanySettings`, `User`, `AuditLog`, `TrialRequest`, `Zone` use `company`; nearly everything else uses `business`. Flagged as a standing copy-paste trap, not urgent — worth documenting per-model rather than mass-renaming.
- In-process, non-distributed caches with TTL (`chartAccountAggregationService.js`, `propertyAccountingService.js`) — fine for single-instance deployment; latent consistency gap only if horizontally scaled.

**Frontend**
- `redux/apiCalls.js`: 3,331-line, ~230-action-creator God-file mixing every domain in the app.
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
2. Redux refetch-check pattern applied once as a shared helper across all
   ~30 list-fetch thunks (the audit's own "biggest realistic win"). **Not
   started.**
3. God-file decomposition (`landlordStatementService.js`, `redux/apiCalls.js`) —
   after 2 lands, since splitting is safer once the logic inside isn't also
   changing for other reasons. **Not started.**
4. `*ImportModal.jsx` consolidation + `MilikTable` memoization fix. **Not started.**
5. Low-priority cleanup batch (`controllers/employee.js` removal, `moment`
   for `recurringSchedule.js`, unused imports) — no urgency, batch whenever.
   **Not started.**

**Do not implement any of the above unilaterally** — still gated on the
user's go-ahead per item, consistent with how every fix in this document was
actually authorized.

---

*Last updated: 2026-09-15. Maintained alongside the work it describes — update Track A/B/D as commits land; update Track C as items are actioned.*
