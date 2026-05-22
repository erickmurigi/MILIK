const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BASE = "http://localhost:5173";
const SS_DIR = "C:\\Users\\murig\\AppData\\Local\\Temp\\pm-verify";
if (!fs.existsSync(SS_DIR)) fs.mkdirSync(SS_DIR, { recursive: true });
fs.readdirSync(SS_DIR).forEach(f => fs.unlinkSync(path.join(SS_DIR, f)));

let step = 0;
const ss = async (page, name) => {
  const file = path.join(SS_DIR, `${String(++step).padStart(2,"0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log("  📸", path.basename(file));
  return file;
};
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// Navigate to a page, wait for idle, check for errors
const navTo = async (page, url, label) => {
  await page.goto(BASE + url);
  await wait(2500);
  await page.waitForLoadState("networkidle").catch(() => {});
  const body = (await page.locator("body").textContent()) || "";
  const hasError = /error|not found|404|forbidden|unauthorized/i.test(body.slice(0, 300)) && !/error handling/i.test(body);
  const hasLoading = /loading\.\.\./i.test(body);
  const isBlank = body.replace(/\s/g, "").length < 50;
  return { url, label, hasError, isBlank, bodyPreview: body.replace(/\s+/g," ").slice(0,120) };
};

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 80 });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const results = [];

  // ── LOGIN ──────────────────────────────────────────────────────────────────
  console.log("=== LOGIN ===");
  await page.goto(BASE + "/login");
  await page.waitForLoadState("networkidle");
  await page.locator("input[type=email]").first().fill("admin@milik.com");
  await page.locator("input[type=password]").first().fill("12345678D.");
  await page.locator("button[type=submit]").first().click();
  await wait(3000);
  await page.waitForLoadState("networkidle");
  console.log("  URL:", page.url());
  await ss(page, "login-done");

  // ── OPEN PROPERTY MANAGEMENT MODULE ───────────────────────────────────────
  console.log("\n=== OPEN PROPERTY MANAGEMENT MODULE ===");
  // Look for Property Management card on module dashboard
  const pmCard = page.locator("div, article").filter({ hasText: /Property Management|MILIK Property/i }).first();
  const pmOpenBtn = pmCard.locator("button, a").filter({ hasText: /Open Module/i }).first();
  if (await pmOpenBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await pmOpenBtn.click();
    await wait(3000);
    await page.waitForLoadState("networkidle");
    console.log("  URL after open:", page.url());
  } else {
    // Navigate directly
    await page.goto(BASE + "/dashboard");
    await wait(3000);
  }
  await ss(page, "pm-module-opened");

  // ── STEP 1: DASHBOARD ──────────────────────────────────────────────────────
  console.log("\n=== STEP 1: Dashboard ===");
  await page.goto(BASE + "/dashboard");
  await wait(3000);
  await page.waitForLoadState("networkidle");
  await ss(page, "dashboard");
  const dashBody = (await page.locator("body").textContent()) || "";
  const hasDashCards = /units|tenants|revenue|maintenance|invoice|receipt|property/i.test(dashBody);
  console.log(hasDashCards ? "✅ Dashboard has summary data" : "⚠️  Dashboard may be empty");
  console.log("  Preview:", dashBody.replace(/\s+/g," ").slice(0, 200));

  // ── STEP 2: PROPERTIES ────────────────────────────────────────────────────
  console.log("\n=== STEP 2: Properties ===");
  await page.goto(BASE + "/properties");
  await wait(2500);
  await page.waitForLoadState("networkidle");
  await ss(page, "properties-list");
  const propBody = (await page.locator("body").textContent()) || "";
  const hasPropData = await page.locator("tbody tr, [class*=card], [class*=property-row]").count();
  console.log(`  Property rows/cards: ${hasPropData}`);
  console.log(hasPropData > 0 ? "✅ Properties list has data" : "⚠️  No property records visible");

  // Try property detail (click first property)
  const propLink = page.locator("a, tr").filter({ hasText: /property|house|flat|suite/i }).first();
  if (await propLink.isVisible({ timeout: 2000 }).catch(() => false)) {
    await propLink.click();
    await wait(2000);
    await ss(page, "property-detail");
    console.log("  ✅ Property detail opened, URL:", page.url());
    await page.goBack();
    await wait(1500);
  }

  // ── STEP 3: UNITS ─────────────────────────────────────────────────────────
  console.log("\n=== STEP 3: Units ===");
  await page.goto(BASE + "/units");
  await wait(2500);
  await page.waitForLoadState("networkidle");
  await ss(page, "units-list");
  const unitRows = await page.locator("tbody tr, [class*=unit-row], [class*=UnitRow]").count();
  console.log(`  Unit rows: ${unitRows}`);
  console.log(unitRows > 0 ? "✅ Units list has data" : "⚠️  No units visible");
  const unitsBody = (await page.locator("body").textContent()) || "";
  console.log("  Preview:", unitsBody.replace(/\s+/g," ").slice(0, 150));

  // Navigate to Add Unit
  console.log("  Checking Add Unit page...");
  await page.goto(BASE + "/units/new");
  await wait(2000);
  await page.waitForLoadState("networkidle");
  await ss(page, "add-unit-page");
  const addUnitBody = (await page.locator("body").textContent()) || "";
  const hasAddUnitForm = /unit|property|floor|rent|type/i.test(addUnitBody);
  console.log(hasAddUnitForm ? "✅ Add Unit form loads" : "❌ Add Unit page failed");
  console.log("  Preview:", addUnitBody.replace(/\s+/g," ").slice(0, 150));

  // ── STEP 4: TENANTS ───────────────────────────────────────────────────────
  console.log("\n=== STEP 4: Tenants ===");
  await page.goto(BASE + "/tenants");
  await wait(2500);
  await page.waitForLoadState("networkidle");
  await ss(page, "tenants-list");
  const tenantRows = await page.locator("tbody tr, [class*=tenant]").count();
  console.log(`  Tenant rows: ${tenantRows}`);
  console.log(tenantRows > 0 ? "✅ Tenants list has data" : "⚠️  No tenant records");
  const tenantsBody = (await page.locator("body").textContent()) || "";
  console.log("  Preview:", tenantsBody.replace(/\s+/g," ").slice(0, 150));

  // Check tenant agreements
  await page.goto(BASE + "/agreements");
  await wait(2000);
  await page.waitForLoadState("networkidle");
  await ss(page, "agreements");
  const agrBody = (await page.locator("body").textContent()) || "";
  console.log("  Agreements preview:", agrBody.replace(/\s+/g," ").slice(0,120));

  // ── STEP 5: INVOICES ──────────────────────────────────────────────────────
  console.log("\n=== STEP 5: Invoices ===");
  await page.goto(BASE + "/invoices/rental");
  await wait(3000);
  await page.waitForLoadState("networkidle");
  await ss(page, "invoices");
  const invoiceRows = await page.locator("tbody tr").count();
  console.log(`  Invoice rows: ${invoiceRows}`);
  console.log(invoiceRows > 0 ? "✅ Invoices list has data" : "⚠️  No invoices");
  const invBody = (await page.locator("body").textContent()) || "";
  console.log("  Preview:", invBody.replace(/\s+/g," ").slice(0, 150));

  // ── STEP 6: RECEIPTS / PAYMENTS ───────────────────────────────────────────
  console.log("\n=== STEP 6: Receipts ===");
  await page.goto(BASE + "/receipts");
  await wait(2500);
  await page.waitForLoadState("networkidle");
  await ss(page, "receipts");
  const receiptRows = await page.locator("tbody tr").count();
  console.log(`  Receipt rows: ${receiptRows}`);
  console.log(receiptRows > 0 ? "✅ Receipts list has data" : "⚠️  No receipts");
  const recBody = (await page.locator("body").textContent()) || "";
  console.log("  Preview:", recBody.replace(/\s+/g," ").slice(0, 150));

  // ── STEP 7: MAINTENANCE ───────────────────────────────────────────────────
  console.log("\n=== STEP 7: Maintenance ===");
  await page.goto(BASE + "/maintenances");
  await wait(2500);
  await page.waitForLoadState("networkidle");
  await ss(page, "maintenances");
  const maintRows = await page.locator("tbody tr, [class*=maint]").count();
  const maintBody = (await page.locator("body").textContent()) || "";
  console.log(`  Maintenance rows: ${maintRows}`);
  console.log("  Preview:", maintBody.replace(/\s+/g," ").slice(0, 150));
  const hasMaintUI = /maintenance|request|status|priority/i.test(maintBody);
  console.log(hasMaintUI ? "✅ Maintenance page loads" : "❌ Maintenance page failed");

  // ── STEP 8: INSPECTIONS ───────────────────────────────────────────────────
  console.log("\n=== STEP 8: Inspections ===");
  await page.goto(BASE + "/inspections");
  await wait(2500);
  await page.waitForLoadState("networkidle");
  await ss(page, "inspections");
  const inspBody = (await page.locator("body").textContent()) || "";
  console.log("  Preview:", inspBody.replace(/\s+/g," ").slice(0, 150));
  const hasInspUI = /inspection|schedule|unit|date/i.test(inspBody);
  console.log(hasInspUI ? "✅ Inspections page loads" : "❌ Inspections page failed");

  // ── STEP 9: METER READINGS ────────────────────────────────────────────────
  console.log("\n=== STEP 9: Meter Readings ===");
  await page.goto(BASE + "/meter-readings");
  await wait(2500);
  await page.waitForLoadState("networkidle");
  await ss(page, "meter-readings");
  const meterBody = (await page.locator("body").textContent()) || "";
  console.log("  Preview:", meterBody.replace(/\s+/g," ").slice(0, 150));
  console.log(/meter|reading|water|electric/i.test(meterBody) ? "✅ Meter Readings loads" : "⚠️  Meter Readings page");

  // ── STEP 10: VACANTS ──────────────────────────────────────────────────────
  console.log("\n=== STEP 10: Vacant Units ===");
  await page.goto(BASE + "/vacants");
  await wait(2500);
  await page.waitForLoadState("networkidle");
  await ss(page, "vacants");
  const vacantsBody = (await page.locator("body").textContent()) || "";
  console.log("  Preview:", vacantsBody.replace(/\s+/g," ").slice(0, 150));
  console.log(/vacant|unit|available|empty/i.test(vacantsBody) ? "✅ Vacants page loads" : "⚠️  Vacants page");

  // ── STEP 11: LANDLORDS ────────────────────────────────────────────────────
  console.log("\n=== STEP 11: Landlords ===");
  await page.goto(BASE + "/landlords");
  await wait(2500);
  await page.waitForLoadState("networkidle");
  await ss(page, "landlords");
  const landlordRows = await page.locator("tbody tr").count();
  const landlordBody = (await page.locator("body").textContent()) || "";
  console.log(`  Landlord rows: ${landlordRows}`);
  console.log("  Preview:", landlordBody.replace(/\s+/g," ").slice(0, 150));

  // ── STEP 12: LATE PENALTIES ───────────────────────────────────────────────
  console.log("\n=== STEP 12: Late Penalties ===");
  await page.goto(BASE + "/invoices/late-penalties");
  await wait(2500);
  await page.waitForLoadState("networkidle");
  await ss(page, "late-penalties");
  const lpBody = (await page.locator("body").textContent()) || "";
  console.log("  Preview:", lpBody.replace(/\s+/g," ").slice(0, 150));
  console.log(/penalt|late|fine|charge/i.test(lpBody) ? "✅ Late Penalties loads" : "⚠️  Late Penalties page");

  // ── STEP 13: LANDLORD STATEMENTS ─────────────────────────────────────────
  console.log("\n=== STEP 13: Landlord Statements ===");
  await page.goto(BASE + "/landlord/statements");
  await wait(2500);
  await page.waitForLoadState("networkidle");
  await ss(page, "landlord-statements");
  const lsBody = (await page.locator("body").textContent()) || "";
  console.log("  Preview:", lsBody.replace(/\s+/g," ").slice(0, 150));

  // ── STEP 14: REPORTS — Rental Collection ─────────────────────────────────
  console.log("\n=== STEP 14: Rental Collection Report ===");
  await page.goto(BASE + "/reports/rental-collection");
  await wait(3000);
  await page.waitForLoadState("networkidle");
  await ss(page, "report-rental-collection");
  const rcBody = (await page.locator("body").textContent()) || "";
  console.log("  Preview:", rcBody.replace(/\s+/g," ").slice(0, 150));
  console.log(/collection|rental|report|period/i.test(rcBody) ? "✅ Rental Collection Report loads" : "⚠️");

  // ── STEP 15: REPORTS — Aged Analysis ─────────────────────────────────────
  console.log("\n=== STEP 15: Aged Analysis Report ===");
  await page.goto(BASE + "/reports/aged-analysis");
  await wait(2500);
  await page.waitForLoadState("networkidle");
  await ss(page, "report-aged-analysis");
  const aaBody = (await page.locator("body").textContent()) || "";
  console.log("  Preview:", aaBody.replace(/\s+/g," ").slice(0, 150));
  console.log(/aged|analysis|balance|debt/i.test(aaBody) ? "✅ Aged Analysis loads" : "⚠️");

  // ── STEP 16: FINANCIAL — Chart of Accounts ────────────────────────────────
  console.log("\n=== STEP 16: Chart of Accounts ===");
  await page.goto(BASE + "/financial/chart-of-accounts");
  await wait(2500);
  await page.waitForLoadState("networkidle");
  await ss(page, "chart-of-accounts");
  const coaBody = (await page.locator("body").textContent()) || "";
  console.log("  Preview:", coaBody.replace(/\s+/g," ").slice(0, 150));
  console.log(/chart|account|asset|liabilit|revenue/i.test(coaBody) ? "✅ Chart of Accounts loads" : "⚠️");

  // ── STEP 17: ADD TENANT flow (open form only) ─────────────────────────────
  console.log("\n=== STEP 17: Add Tenant form ===");
  await page.goto(BASE + "/tenant/new");
  await wait(2500);
  await page.waitForLoadState("networkidle");
  await ss(page, "add-tenant");
  const atBody = (await page.locator("body").textContent()) || "";
  console.log("  Preview:", atBody.replace(/\s+/g," ").slice(0, 150));
  console.log(/tenant|unit|lease|rent|name|email/i.test(atBody) ? "✅ Add Tenant form loads" : "❌ Add Tenant failed");

  // ── STEP 18: TENANT DEPOSITS ──────────────────────────────────────────────
  console.log("\n=== STEP 18: Tenant Deposits ===");
  await page.goto(BASE + "/tenants/deposits");
  await wait(2500);
  await page.waitForLoadState("networkidle");
  await ss(page, "tenant-deposits");
  const tdBody = (await page.locator("body").textContent()) || "";
  console.log("  Preview:", tdBody.replace(/\s+/g," ").slice(0, 150));

  // ── STEP 19: PAYMENT VOUCHERS ────────────────────────────────────────────
  console.log("\n=== STEP 19: Payment Vouchers ===");
  await page.goto(BASE + "/financial/payment-vouchers");
  await wait(2500);
  await page.waitForLoadState("networkidle");
  await ss(page, "payment-vouchers");
  const pvBody = (await page.locator("body").textContent()) || "";
  console.log("  Preview:", pvBody.replace(/\s+/g," ").slice(0, 150));
  console.log(/voucher|payment|expense/i.test(pvBody) ? "✅ Payment Vouchers loads" : "⚠️");

  // ── STEP 20: COMPANY SETTINGS ─────────────────────────────────────────────
  console.log("\n=== STEP 20: Company Settings ===");
  await page.goto(BASE + "/company-setup");
  await wait(2500);
  await page.waitForLoadState("networkidle");
  await ss(page, "company-setup");
  const csBody = (await page.locator("body").textContent()) || "";
  console.log("  Preview:", csBody.replace(/\s+/g," ").slice(0, 150));
  console.log(/company|settings|setup|name|email/i.test(csBody) ? "✅ Company Settings loads" : "⚠️");

  // ── NAVIGATION PROBE: check all links in PM sidebar ───────────────────────
  console.log("\n=== 🔍 PROBE: Sidebar nav links ===");
  await page.goto(BASE + "/dashboard");
  await wait(2500);
  await page.waitForLoadState("networkidle");
  const navLinks = await page.locator("nav a, [class*=sidebar] a, [class*=menu] a").all();
  console.log(`  Nav links found: ${navLinks.length}`);
  const linkHrefs = [];
  for (const link of navLinks.slice(0, 30)) {
    const href = await link.getAttribute("href").catch(() => "");
    const text = (await link.textContent().catch(() => "")).trim().slice(0, 30);
    if (href && !href.startsWith("http") && href !== "/" && !linkHrefs.includes(href)) {
      linkHrefs.push(href);
    }
  }
  console.log("  Nav hrefs:", linkHrefs.join(", "));

  console.log("\n========== PROPERTY MANAGEMENT VERIFICATION COMPLETE ==========");
  await browser.close();
})().catch(err => {
  console.error("FATAL:", err.message, "\n", err.stack ? err.stack.slice(0, 500) : "");
  process.exit(1);
});
