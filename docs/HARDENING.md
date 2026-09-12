# Hardening & Optimization Status

Living status document for the security hardening and system optimization work
started 2026-09-12/13. Three tracks: bug fixes already landed on `main`
(Track A), the security hotfix branch awaiting merge (Track B), and the
whole-codebase optimization audit awaiting a scoping decision (Track C).

---

## Track A — Landlord statement / receipt fixes (committed on `main`)

All four committed, tested (backend suites green; frontend syntax-checked and
linted but not manually verified in a live browser).

| Commit | Summary |
|---|---|
| `0def581` | Fix: stop double-counting untagged unapplied receipt rows in the raw ledger (`getReceiptRentLedgerCash`) |
| `feb278d` | Fix: `confirmPayment` was dropping a prepayment's `isPrepayment`/`billItemKey`/`prepaymentLabel` tags when rebuilding allocations on confirm |
| `6f53c68` | Feat: surface a receipt's held-prepayment history on the Statement Allocations admin page (new `prepayment_recognized` audit trail + "Type" badges); also fixed the admin "Mark as Prepayment" tool dropping the same tags |
| `375f105` | Feat: company-wide manual receipt confirmation policy (`on_save` vs `on_review`), replacing the per-receipt "Mark as Confirmed" checkbox |
| `99c056b` | Chore: removed 3 confirmed-dead backend files (see Track C, item C-B2) |

**Open item**: frontend changes (AddReceipt.jsx, Receipts.jsx, LandlordStatementAllocations.jsx, SystemSetup/CompanySettings.jsx) have not been manually clicked through in a browser.

---

## Track B — Security hotfix (branch pushed, **not merged**)

Branch: `fix/security-hotfix-2026-09-12` (off `main` @ `8ea0e5d`), pushed to
origin. PR not confirmed created — open one at:
`https://github.com/erickmurigi/MILIK/pull/new/fix/security-hotfix-2026-09-12`

Full test suite: 28/28 files, 115/115 tests passing as of last full run.

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

### Next step for Track C

Present this document to the user, agree on scope and sequencing together, then execute in phases. **Do not implement any of the above unilaterally** — this was explicitly gated on a "scan, then deliberate, then implement" agreement.

---

*Last updated: 2026-09-13. Maintained alongside the work it describes — update this file's Track A/B sections as commits land or the PR status changes; update Track C as items are actioned.*
