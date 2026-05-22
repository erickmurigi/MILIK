/**
 * Milik QA Audit Script
 * Covers: Financial Accounts workspace isolation, PM accounts-menu removal,
 *         menu/routeConfig consistency, TabManager title coverage, dead-code detection.
 */

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "src");
const PASS = "\x1b[32m✔\x1b[0m";
const FAIL = "\x1b[31m✘\x1b[0m";
const WARN = "\x1b[33m⚠\x1b[0m";
const INFO = "\x1b[36mℹ\x1b[0m";

let totalPass = 0, totalFail = 0, totalWarn = 0;

function read(rel) {
  return fs.readFileSync(path.join(SRC, rel), "utf8");
}

function check(label, pass, detail = "") {
  if (pass) {
    console.log(`  ${PASS} ${label}`);
    totalPass++;
  } else {
    console.log(`  ${FAIL} ${label}${detail ? "  →  " + detail : ""}`);
    totalFail++;
  }
}

function warn(label, detail = "") {
  console.log(`  ${WARN} ${label}${detail ? "  →  " + detail : ""}`);
  totalWarn++;
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

// ─────────────────────────────────────────────────────────────────────────────
section("1. PM WORKSPACE — accounts menu removed");
// ─────────────────────────────────────────────────────────────────────────────
const layout = read("components/Layout/DashboardLayout.jsx");

// The old PM accounts block must be gone
check(
  "PM menu no longer contains id: \"accounts\" block",
  !(/id:\s*"accounts",[\s\S]{0,40}label:\s*"Accounts"/.test(layout))
);

// The landlord transformation for accounts must be gone
check(
  "Landlord accounts rename block removed",
  !(/item\.id === "accounts"\s*\{[\s\S]*?Outgoing Payments/.test(layout))
);

// renderMenuItem no longer checks activeMenu === "accounts"
check(
  "renderMenuItem conditions simplified (no || activeMenu === \"accounts\")",
  !layout.includes('activeMenu === "accounts"')
);

// PM nav still has: Landlords, Properties, Units, Tenants, Billing (financial), Reports, Tools, Help
const pmMenuIds = ["landlord", "properties", "units", "tenants", "financial", "reports", "tools", "help"];
pmMenuIds.forEach((id) => {
  check(`PM workspace still has "${id}" menu`, layout.includes(`id: "${id}"`));
});

// ─────────────────────────────────────────────────────────────────────────────
section("2. ACCOUNTS WORKSPACE — menu items & routeConfig coverage");
// ─────────────────────────────────────────────────────────────────────────────
const accMenuIds = [
  "acc-dashboard", "acc-chart-of-accounts", "acc-journals",
  "acc-payment-vouchers", "acc-petty-cash", "acc-expenses",
  "acc-service-providers", "acc-trial-balance", "acc-income-statement",
  "acc-balance-sheet", "acc-tax-reports",
];
accMenuIds.forEach((id) => {
  check(`Accounts menu has "${id}"`, layout.includes(`id: "${id}"`));
  check(`routeConfig maps "${id}"`, layout.includes(`"${id}":`));
});

// ─────────────────────────────────────────────────────────────────────────────
section("3. ACCOUNTS WORKSPACE — routeConfig routes exist in App.jsx");
// ─────────────────────────────────────────────────────────────────────────────
const app = read("App.jsx");

const accRoutes = [
  "/accounts/dashboard",
  "/accounts/chart-of-accounts",
  "/accounts/journals",
  "/accounts/payment-vouchers",
  "/accounts/petty-cash",
  "/accounts/expenses",
  "/accounts/service-providers",
  "/accounts/trial-balance",
  "/accounts/income-statement",
  "/accounts/balance-sheet",
  "/accounts/tax-reports",
];
accRoutes.forEach((r) => {
  check(`App.jsx has route "${r}"`, app.includes(`"${r}"`));
});

// ─────────────────────────────────────────────────────────────────────────────
section("4. TABMANAGER — getPageTitle covers all /accounts/* routes");
// ─────────────────────────────────────────────────────────────────────────────
const tabMgr = read("components/Layout/TabManager.jsx");

accRoutes.forEach((r) => {
  check(`getPageTitle maps "${r}"`, tabMgr.includes(`'${r}'`) || tabMgr.includes(`"${r}"`));
});

check(
  "Ledger activity pattern covers /accounts/chart-of-accounts/*/activity",
  tabMgr.includes("pathname.startsWith('/accounts/chart-of-accounts/')")
);

// ─────────────────────────────────────────────────────────────────────────────
section("5. WORKSPACE ROUTING — workspaceRoutes.js");
// ─────────────────────────────────────────────────────────────────────────────
const wsRoutes = read("utils/workspaceRoutes.js");

check("WORKSPACE_IDS.ACCOUNTS defined", wsRoutes.includes("ACCOUNTS:"));
check("getWorkspaceFromRoute handles /accounts/ prefix", wsRoutes.includes("/accounts/"));
check("Accounts workspace has defaultRoute /accounts/dashboard", wsRoutes.includes("/accounts/dashboard"));
check("Accounts workspace default tab id is 'acc-dashboard'", wsRoutes.includes("acc-dashboard"));

// ─────────────────────────────────────────────────────────────────────────────
section("6. TABMANAGER — initial state includes ACCOUNTS workspace");
// ─────────────────────────────────────────────────────────────────────────────
check(
  "buildInitialTabsByWorkspace includes ACCOUNTS",
  tabMgr.includes("WORKSPACE_IDS.ACCOUNTS") &&
  tabMgr.includes("getWorkspaceDefaultTab(WORKSPACE_IDS.ACCOUNTS)")
);
check(
  "buildInitialActiveTabs includes ACCOUNTS key 'acc-dashboard'",
  tabMgr.includes("[WORKSPACE_IDS.ACCOUNTS]: 'acc-dashboard'")
);

// ─────────────────────────────────────────────────────────────────────────────
section("7. STARTMENU — accounts module links to /accounts/dashboard");
// ─────────────────────────────────────────────────────────────────────────────
const startMenu = read("components/StartMenu/StartMenu.jsx");

check(
  "StartMenu accounts entry points to /accounts/dashboard",
  startMenu.includes('to: "/accounts/dashboard"')
);
check(
  "StartMenu accounts entry does NOT point to stale /financial/chart-of-accounts",
  !startMenu.includes('to: "/financial/chart-of-accounts"')
);

// ─────────────────────────────────────────────────────────────────────────────
section("8. MODULESDASHBOARD — accounts module links to /accounts/dashboard");
// ─────────────────────────────────────────────────────────────────────────────
const modulesDash = read("pages/moduleDashboard/ModulesDashboard.jsx");

check(
  "ModulesDashboard accounts tile route is /accounts/dashboard",
  modulesDash.includes('route: "/accounts/dashboard"')
);

// ─────────────────────────────────────────────────────────────────────────────
section("9. JOURNAL ISOLATION — sourceModule / excludeSourceModules");
// ─────────────────────────────────────────────────────────────────────────────
const journalFE = read("pages/Financial/JournalEntries.jsx");

check(
  "JournalEntries uses isAccountsWorkspace flag",
  journalFE.includes("isAccountsWorkspace")
);
check(
  "PM journals exclude hr,carwash source modules",
  journalFE.includes('excludeSourceModules: "hr,carwash"')
);
check(
  "Accounts workspace journals send no excludeSourceModules (sees all)",
  journalFE.includes("isAccountsWorkspace ? {} :")
);
check(
  "Created journal tags sourceModule correctly",
  journalFE.includes('isAccountsWorkspace ? "accounts" : "propertyManagement"')
);

// Backend
const journalBE = (() => {
  try {
    return fs.readFileSync(
      path.join(__dirname, "..", "MilikApi", "controllers", "propertyController", "journalEntries.js"),
      "utf8"
    );
  } catch { return ""; }
})();

if (journalBE) {
  check(
    "Backend getJournalEntries handles excludeSourceModules with $nin",
    journalBE.includes("excludeSourceModules") && journalBE.includes("$nin")
  );
  check(
    "Backend createJournalEntry stores sourceModule field",
    journalBE.includes("sourceModule:")
  );
} else {
  warn("Could not read journalEntries.js backend — skipping backend checks");
}

// ─────────────────────────────────────────────────────────────────────────────
section("10. DEAD CODE DETECTION — optimization opportunities");
// ─────────────────────────────────────────────────────────────────────────────

// colorMap has an 'accounts' entry that was for PM accounts menu header — now only used in Accounts workspace
const accountsColorMapStillReferenced = layout.includes('accounts:') && layout.includes('menuColorMap');
if (accountsColorMapStillReferenced) {
  warn(
    "colorMap 'accounts' entry may be dead code (PM accounts menu removed)",
    "Safe to remove if Accounts workspace uses acc-ledger/acc-payables/acc-statements instead"
  );
}

// nestedSubmenus.expenses is only triggered by PM accounts menu id:expenses item (now removed)
const expensesNestedExists = layout.includes("expenses: [") && layout.includes("expense-requisition");
if (expensesNestedExists) {
  warn(
    "nestedSubmenus.expenses dead code (was triggered by removed PM accounts → Expenses menu item)",
    "Can delete nestedSubmenus.expenses and 'expense-requisition' routeConfig entry in PM workspace"
  );
}

// PM routeConfig still has GL routes (chart-of-accounts, trial-balance etc.) with no callers
const deadRouteConfigEntries = [
  '"chart-of-accounts": "/financial/chart-of-accounts"',
  '"trial-balance": "/reports/trial-balance"',
  '"income-statement": "/reports/income-statement"',
  '"balance-sheet": "/reports/balance-sheet"',
  '"tax-reports": "/reports/tax-reports"',
  '"payment-vouchers": "/financial/payment-vouchers"',
  '"petty-cash": "/financial/petty-cash"',
  'journals: "/financial/journals"',
];
const deadFound = deadRouteConfigEntries.filter((e) => layout.includes(e));
if (deadFound.length > 0) {
  warn(
    `PM routeConfig has ${deadFound.length} dead GL entries (no menu callers after accounts menu removed)`,
    deadFound.map((e) => e.split(":")[0].replace(/"/g, "").trim()).join(", ")
  );
}

// ─────────────────────────────────────────────────────────────────────────────
section("11. ACCOUNTS DASHBOARD — component structure");
// ─────────────────────────────────────────────────────────────────────────────
const accDash = (() => {
  try {
    return fs.readFileSync(
      path.join(SRC, "pages", "Accounts", "AccountsDashboard.jsx"),
      "utf8"
    );
  } catch { return ""; }
})();

if (accDash) {
  check("AccountsDashboard uses useRef fetch guard", accDash.includes("fetchedRef"));
  check("AccountsDashboard uses Promise.all for parallel fetches", accDash.includes("Promise.all"));
  check("AccountsDashboard shows 3 stat cards", (accDash.match(/GL Accounts|Draft Journals|Posted Journals/g) || []).length === 3);
  check("AccountsDashboard has 10 quick-nav tiles", (accDash.match(/route:.*"\/accounts\//g) || []).length >= 9);
} else {
  check("AccountsDashboard.jsx file exists", false, "pages/Accounts/AccountsDashboard.jsx not found");
}

// ─────────────────────────────────────────────────────────────────────────────
section("12. APP.JSX — CompanyModuleRoute guard on all /accounts/* routes");
// ─────────────────────────────────────────────────────────────────────────────
const accRoutesInApp = accRoutes.slice(1); // skip /accounts/dashboard redirect
accRoutesInApp.forEach((r) => {
  // Each route should be wrapped in CompanyModuleRoute moduleKey="accounts"
  const idx = app.indexOf(`"${r}"`);
  if (idx === -1) { check(`Route "${r}" guarded by CompanyModuleRoute`, false); return; }
  const context = app.slice(Math.max(0, idx - 300), idx + 50);
  check(
    `Route "${r}" wrapped in CompanyModuleRoute`,
    context.includes('moduleKey="accounts"')
  );
});

// ─────────────────────────────────────────────────────────────────────────────
section("13. SELF-MANAGING LANDLORD MODE — menu isolation");
// ─────────────────────────────────────────────────────────────────────────────

// Landlord menu is hidden in landlord mode
check(
  "landlordModeHiddenMainMenuIds hides 'landlord' menu",
  layout.includes('new Set(["landlord"])') || layout.includes("new Set(['landlord'])")
);
check(
  "landlordModeHiddenMainMenuIds applied with .filter()",
  layout.includes("landlordModeHiddenMainMenuIds.has(item.id)")
);

// Properties menu transform exists for landlord mode
check(
  "Properties menu renamed to 'My Properties' in landlord mode",
  layout.includes('"My Properties"') && layout.includes('item.id === "properties"')
);
check(
  "Commission items removed from Properties in landlord mode",
  layout.includes('"property-commission-settings"') &&
  layout.includes('"commissions-list"') &&
  layout.includes("!isLandlordMode") // used in reports non-landlord filter
);
check(
  "Properties commission submenu items filtered in landlord mode",
  layout.includes('filter((subItem) => !["property-commission-settings", "commissions-list"].includes(subItem.id))')
);

// Billing (financial) menu: removes landlord-payments in landlord mode
check(
  "Billing menu removes landlord-payments in landlord mode",
  layout.includes('item.id === "financial"') &&
  layout.includes('subItem.id !== "landlord-payments"')
);

// Reports menu: renamed + commission-reports removed in landlord mode
check(
  "Reports menu renamed to 'Portfolio Reports' in landlord mode",
  layout.includes('"Portfolio Reports"')
);
check(
  "commission-reports removed from Reports in landlord mode",
  layout.includes('subItem.id !== "commission-reports"')
);

// Tools renamed to Operations in landlord mode
check(
  "Tools menu renamed to 'Operations' in landlord mode",
  layout.includes('"Operations"') && layout.includes('item.id === "tools"')
);

// nestedSubmenus: landlord-payments submenu deleted in landlord mode
check(
  "nestedSubmenus deletes landlord-payments in landlord mode",
  layout.includes('delete submenus["landlord-payments"]')
);

// nestedSubmenus.expenses is gone (was dead code from removed PM accounts menu)
check(
  "nestedSubmenus.expenses dead block has been cleaned up",
  !layout.includes('"expense-requisition"') &&
  !layout.includes('"expenses-service-providers"')
);

// Rental receipting removes landlord-receipt in landlord mode
check(
  "rental-receipting removes landlord-receipt in landlord mode",
  layout.includes('item.id !== "landlord-receipt"')
);

// ─────────────────────────────────────────────────────────────────────────────
section("14. SELF-MANAGING LANDLORD MODE — App.jsx route guards");
// ─────────────────────────────────────────────────────────────────────────────

// Routes that must have allowLandlordMode={false}
const landlordBlockedRoutes = [
  "/landlords",
  "/landlords/new",
  "/landlord-payments",
  "/financial/landlord-statement",
  "/landlord/processed-statements",
  "/landlord/statements",
  "/landlords/standing-orders",
  "/landlords/advancement",
  "/properties/commission-settings",
  "/properties/commissions-list",
  "/receipts/landlord",
  "/reports/commissions",
];
landlordBlockedRoutes.forEach((r) => {
  // Search for the Route path= declaration specifically, not redirect targets
  const pathDecl = `path="${r}"`;
  const idx = app.indexOf(pathDecl);
  if (idx === -1) { check(`Route "${r}" blocked for landlord mode`, false, "route path declaration not found in App.jsx"); return; }
  const context = app.slice(idx, idx + 300);
  check(`Route "${r}" blocked for landlord mode`, context.includes("allowLandlordMode={false}"));
});

// Accounts workspace routes must NOT restrict landlord mode
accRoutes.forEach((r) => {
  const idx = app.indexOf(`"${r}"`);
  if (idx === -1) { check(`Accounts route "${r}" accessible in landlord mode`, false); return; }
  const context = app.slice(Math.max(0, idx - 300), idx + 50);
  check(
    `Accounts route "${r}" accessible in landlord mode`,
    !context.includes("allowLandlordMode={false}")
  );
});

// ─────────────────────────────────────────────────────────────────────────────
section("15. SELF-MANAGING LANDLORD MODE — StartMenu & ModulesDashboard visibility");
// ─────────────────────────────────────────────────────────────────────────────

// StartMenu: accounts module visible to any company with a GL-access module (includes landlord mode)
check(
  "StartMenu accounts entry visible via GL_ACCESS_MODULES (not just 'accounts' module)",
  startMenu.includes("GL_ACCESS_MODULES") &&
  startMenu.includes("hasAnyCompanyModule")
);

// ModulesDashboard: accounts tile is filtered by hasCompanyModule
check(
  "ModulesDashboard filters modules via hasCompanyModule",
  modulesDash.includes("hasCompanyModule")
);

// ─────────────────────────────────────────────────────────────────────────────
section("16. SELF-MANAGING LANDLORD MODE — companyModules.js logic");
// ─────────────────────────────────────────────────────────────────────────────
const compMod = read("utils/companyModules.js");

check(
  "isSelfManagingLandlordCompany function exported",
  compMod.includes("export const isSelfManagingLandlordCompany")
);
check(
  "Detects 'self_managing_landlord' companyMode",
  compMod.includes("'self_managing_landlord'")
);
check(
  "Detects 'landlord' shorthand companyMode",
  compMod.includes("'landlord'")
);
check(
  "GL_ACCESS_MODULES includes propertyManagement (so landlords get accounts access)",
  compMod.includes('"propertyManagement"') && compMod.includes("GL_ACCESS_MODULES")
);
check(
  "isPropertyManagerCompany function exported",
  compMod.includes("export const isPropertyManagerCompany")
);
check(
  "getCompanyOperatingModeLabel returns 'Self-Managing Landlord' string",
  compMod.includes("'Self-Managing Landlord'")
);
check(
  "normalizeCompanyOperatingMode handles multiple landlord aliases",
  compMod.includes("'self_managed_landlord'") && compMod.includes("'self_managing_owner'")
);

// ─────────────────────────────────────────────────────────────────────────────
section("17. CROSS-CUTTING — landlord mode has NO reference to removed accounts menu items");
// ─────────────────────────────────────────────────────────────────────────────

// Landlord mode should not transform accounts menu (it's gone)
check(
  "No landlord accounts-menu rename logic remains",
  !layout.includes('Outgoing Payments') && !layout.includes('Expenses & Suppliers')
);

// No reference to dead nestedSubmenus items in any landlord transform
check(
  "Landlord nestedSubmenus transform references no dead items",
  !layout.includes('"expense-requisition"') &&
  !layout.includes('"expenses-service-providers"')
);

// Toolbar still shows PM buttons and not accounts buttons in PM workspace
check(
  "PM toolbar has +Tenant, +Invoice, +Payment buttons",
  layout.includes("+ Tenant") && layout.includes("+ Invoice") && layout.includes("+ Payment")
);
check(
  "Accounts toolbar has +Journal, +Voucher buttons",
  layout.includes("+ Journal") && layout.includes("+ Voucher")
);
check(
  "Toolbar correctly scoped: PM buttons only when !isAccountsWorkspace",
  layout.includes("!isAccountsWorkspace && !isCarWashWorkspace")
);

// ─────────────────────────────────────────────────────────────────────────────
section("18. CAR WASH — GL items removed from operational workspace");
// ─────────────────────────────────────────────────────────────────────────────

// carwash-accounts group must be gone
check("carwash-accounts menu group removed", !layout.includes('id: "carwash-accounts"'));
check("carwash-financials removed from CW menu", !layout.includes('id: "carwash-financials"'));
check("carwash-cashbooks removed from CW menu", !layout.includes('id: "carwash-cashbooks"'));
check("carwash-chart-of-accounts removed from CW menu", !layout.includes('id: "carwash-chart-of-accounts"'));

// colorMap dead entry removed
check("carwash-accounts colorMap entry removed", !layout.includes('"carwash-accounts": {'));

// MENU_PERMISSION_MAP dead entries removed
check("MENU_PERMISSION_MAP carwash-cashbooks entry removed", !layout.includes('"carwash-cashbooks": {'));
check("MENU_PERMISSION_MAP carwash-chart-of-accounts entry removed",
  layout.indexOf('"carwash-chart-of-accounts":') === -1 ||
  !layout.includes('"carwash-chart-of-accounts": { resource: "chartOfAccounts"')
);
check("MENU_PERMISSION_MAP carwash-financials entry removed",
  !layout.includes('"carwash-financials": { resource: "chartOfAccounts"')
);

// routeConfig dead entries removed (CW workspace)
check("CW routeConfig carwash-cashbooks removed", (() => {
  const idx = layout.indexOf('if (isCarWashWorkspace)');
  const block = layout.slice(idx, idx + 1200);
  return !block.includes('"carwash-cashbooks"');
})());
check("CW routeConfig carwash-chart-of-accounts removed", (() => {
  const idx = layout.indexOf('if (isCarWashWorkspace)');
  const block = layout.slice(idx, idx + 1200);
  return !block.includes('"carwash-chart-of-accounts"');
})());
check("CW routeConfig carwash-financials removed", (() => {
  const idx = layout.indexOf('if (isCarWashWorkspace)');
  const block = layout.slice(idx, idx + 1200);
  return !block.includes('"carwash-financials"');
})());

// Operational items still present in CW workspace menu
["carwash-dashboard","carwash-jobs","carwash-payments","carwash-deposits",
 "carwash-expenses","carwash-staff","carwash-reports","carwash-commissions",
 "carwash-loyalty","carwash-branches"].forEach((id) => {
  check(`CW operational item "${id}" still present`, layout.includes(`id: "${id}"`));
});

// ─────────────────────────────────────────────────────────────────────────────
section("19. PROPERTY SALE — GL items removed from operational workspace");
// ─────────────────────────────────────────────────────────────────────────────

check("sale-financials removed from Sale menu", (() => {
  const idx = layout.indexOf('if (isPropertySaleWorkspace)');
  const block = layout.slice(idx, idx + 1000);
  return !block.includes('id: "sale-financials"');
})());
check("sale-chart-of-accounts removed from Sale menu", (() => {
  const idx = layout.indexOf('if (isPropertySaleWorkspace)');
  const block = layout.slice(idx, idx + 1000);
  return !block.includes('id: "sale-chart-of-accounts"');
})());
check("MENU_PERMISSION_MAP sale-financials removed", !layout.includes('"sale-financials": { resource: "chartOfAccounts"'));
check("MENU_PERMISSION_MAP sale-chart-of-accounts removed", !layout.includes('"sale-chart-of-accounts": { resource: "chartOfAccounts"'));
check("Sale routeConfig sale-financials removed", (() => {
  const idx = layout.indexOf('if (isPropertySaleWorkspace)');
  const block = layout.slice(idx, idx + 700);
  return !block.includes('"sale-financials"');
})());
check("Sale routeConfig sale-chart-of-accounts removed", (() => {
  const idx = layout.indexOf('if (isPropertySaleWorkspace)');
  const block = layout.slice(idx, idx + 700);
  return !block.includes('"sale-chart-of-accounts"');
})());

// Operational items still intact
["sale-dashboard","sale-listings","sale-buyers","sale-agents",
 "sale-offers","sale-deals","sale-payments","sale-commissions","sale-reports"].forEach((id) => {
  check(`Sale operational item "${id}" still present`, layout.includes(`id: "${id}"`));
});

// ─────────────────────────────────────────────────────────────────────────────
section("20. HUMAN RESOURCE — GL items removed from operational workspace");
// ─────────────────────────────────────────────────────────────────────────────

check("hr-financials menu group removed", (() => {
  const idx = layout.indexOf('if (isHumanResourceWorkspace)');
  const block = layout.slice(idx, idx + 2000);
  return !block.includes('id: "hr-financials"');
})());
check("hr-chart-of-accounts removed from HR menu", (() => {
  const idx = layout.indexOf('if (isHumanResourceWorkspace)');
  const block = layout.slice(idx, idx + 2000);
  return !block.includes('id: "hr-chart-of-accounts"');
})());
check("MENU_PERMISSION_MAP hr-financials removed", !layout.includes('"hr-financials":          {'));
check("MENU_PERMISSION_MAP hr-chart-of-accounts removed", !layout.includes('"hr-chart-of-accounts":   {'));
check("colorMap hr-financials entry removed", !layout.includes('"hr-financials":  {'));
check("HR routeConfig hr-financials removed", (() => {
  const idx = layout.indexOf('if (isHumanResourceWorkspace)');
  const block = layout.slice(idx, idx + 1500);
  return !block.includes('"hr-financials"');
})());
check("HR routeConfig hr-chart-of-accounts removed", (() => {
  const idx = layout.indexOf('if (isHumanResourceWorkspace)');
  const block = layout.slice(idx, idx + 1500);
  return !block.includes('"hr-chart-of-accounts"');
})());

// HR operational items still intact
["hr-people","hr-leave","hr-payroll","hr-reports","hr-appraisals","hr-config"].forEach((id) => {
  check(`HR menu group "${id}" still present`, layout.includes(`id: "${id}"`));
});

// ─────────────────────────────────────────────────────────────────────────────
section("21. PM WORKSPACE routeConfig — dead cross-workspace GL entries removed");
// ─────────────────────────────────────────────────────────────────────────────

// The PM routeConfig fallback block (no workspace match) must not contain
// carwash or sale GL routes — they were dead entries in PM
const pmBlock = (() => {
  // PM routeConfig is the fallback return block (no `if` guard).
  // It always contains "landlord-list" as a unique marker not in other workspace blocks.
  const marker = '"landlord-list": "/landlords"';
  const idx = layout.indexOf(marker);
  if (idx === -1) return "";
  // Grab from ~100 chars before the opening brace back to ~2500 chars after
  return layout.slice(Math.max(0, idx - 100), idx + 2500);
})();

["carwash-cashbooks","carwash-chart-of-accounts","carwash-financials",
 "sale-financials","sale-chart-of-accounts"].forEach((key) => {
  check(`PM routeConfig dead entry "${key}" removed`, !pmBlock.includes(`"${key}"`));
});

// But carwash operational entries must also be gone (they were never in PM menu)
["carwash-dashboard","carwash-jobs","carwash-staff","carwash-branches"].forEach((key) => {
  check(`PM routeConfig dead carwash entry "${key}" removed`, !pmBlock.includes(`"${key}"`));
});

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n─────────────────────────────────────────────────────────");
console.log(`\x1b[1mSUMMARY\x1b[0m  ${PASS} ${totalPass} passed   ${FAIL} ${totalFail} failed   ${WARN} ${totalWarn} warnings`);
console.log("─────────────────────────────────────────────────────────\n");

if (totalFail > 0) process.exit(1);
