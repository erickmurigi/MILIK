import { createPage, resetBrowser } from "./browserService.js";

let activeRenders = 0;
const MAX_CONCURRENT = 2;
const waitQueue = [];
const QUEUE_TIMEOUT_MS = 120_000;
const RENDER_TIMEOUT_MS = 60_000;

const esc = (v = "") =>
  String(v || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

const fmt = (v) =>
  new Intl.NumberFormat("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Number(v || 0)
  );

const fmtDate = (v) => (v ? new Date(v).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" }) : "—");

const withTimeout = (promise, ms, message) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms)
    ),
  ]);

async function acquireSlot() {
  if (activeRenders < MAX_CONCURRENT) { activeRenders++; return; }
  await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const idx = waitQueue.indexOf(doResolve);
      if (idx !== -1) waitQueue.splice(idx, 1);
      reject(new Error("PDF render queue timeout — server is busy, please retry shortly"));
    }, QUEUE_TIMEOUT_MS);
    const doResolve = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    waitQueue.push(doResolve);
  });
  activeRenders++;
}

function releaseSlot() {
  activeRenders = Math.max(0, activeRenders - 1);
  const next = waitQueue.shift();
  if (next) next();
}

const buildAddress = (business = {}) =>
  [business.roadStreet || business.Street, business.town || business.City, business.country]
    .filter(Boolean)
    .join(", ");

const billingLabel = (key = "") => {
  const map = { monthly: "Monthly", bimonthly: "Bi-Monthly", quarterly: "Quarterly", annually: "Annual", weekly: "Weekly", daily: "Daily" };
  return map[String(key).toLowerCase()] || key || "Monthly";
};

const buildHtml = (lease) => {
  const business = lease.business || {};
  const tenant = lease.tenant || {};
  const unit = lease.unit || {};
  const property = unit.property || {};
  const landlord = lease.landlord || {};

  const businessName = esc(business.companyName || business.name || "Milik");
  const businessSlogan = esc(business.slogan || "Modern Property Management");
  const businessLogo = business.logo || "";
  const businessAddr = esc(buildAddress(business));
  const businessPostal = esc(business.postalAddress || business.POBOX || "");
  const businessPhone = esc(business.phoneNo || business.phone || "");
  const businessEmail = esc(business.email || "");

  const tenantName = esc(tenant.name || "—");
  const tenantId = esc(tenant.idNumber || "—");
  const tenantPhone = esc(tenant.phone || "—");
  const tenantEmail = esc(tenant.email || "—");
  const tenantCode = esc(tenant.tenantCode || "");

  const unitNumber = esc(unit.unitNumber || unit.unitName || unit.name || "—");
  const propertyName = esc(property.propertyName || property.name || "—");
  const propertyCode = esc(property.propertyCode || "");
  const propertyAddr = esc(property.address || "");

  const landlordName = esc(landlord.landlordName || "—");
  const landlordPhone = esc(landlord.phoneNumber || "—");
  const landlordEmail = esc(landlord.email || "—");

  const agreementNo = esc(lease.agreementNumber || "—");
  const leaseType = lease.leaseType === "at_will" ? "Month-to-Month (At Will)" : "Fixed Term";
  const startDate = fmtDate(lease.startDate);
  const endDate = lease.leaseType === "at_will" ? "Ongoing (At Will)" : fmtDate(lease.endDate);
  const rentAmount = fmt(lease.rentAmount);
  const depositAmount = fmt(lease.depositAmount);
  const dueDay = lease.paymentDueDay || 5;
  const billing = billingLabel(lease.billingPeriodKey);
  const noticeDays = lease.noticePeriodDays || 30;
  const lateFee = Number(lease.lateFee || 0);
  const terms = esc(lease.terms || "");
  const generatedDate = fmtDate(new Date());

  const lateFeeRow = lateFee > 0
    ? `<tr><td class="label">Late Payment Fee</td><td>KES ${fmt(lateFee)} per billing period after due date</td></tr>`
    : "";

  const termsSection = terms
    ? `<div class="section-title">Special Terms &amp; Conditions</div>
       <p class="terms-text">${terms.replace(/\n/g, "<br>")}</p>`
    : "";

  const propertyLine = propertyCode
    ? `${propertyCode} &mdash; ${propertyName}${propertyAddr ? `, ${propertyAddr}` : ""}`
    : `${propertyName}${propertyAddr ? `, ${propertyAddr}` : ""}`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Lease Agreement &mdash; ${agreementNo}</title>
  <style>
    @page { size: A4 portrait; margin: 15mm 14mm 15mm 14mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 9.5px; color: #111827; background: #fff; line-height: 1.5; }

    .sheet { max-width: 182mm; margin: 0 auto; }

    /* Header */
    .header { display: flex; align-items: flex-start; justify-content: space-between; border-bottom: 2.5px solid #0B3B2E; padding-bottom: 8px; margin-bottom: 10px; }
    .brand { display: flex; align-items: center; gap: 10px; }
    .brand-logo { width: 52px; height: 52px; object-fit: contain; }
    .brand-fallback { width: 52px; height: 52px; background: #0B3B2E; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 900; border-radius: 4px; }
    .brand-info .name { font-size: 17px; font-weight: 900; color: #0B3B2E; }
    .brand-info .slogan { font-size: 8px; color: #6b7280; margin-top: 1px; }
    .brand-info .contact { font-size: 8px; color: #374151; margin-top: 2px; }
    .header-right { text-align: right; font-size: 8px; color: #374151; }
    .header-right .doc-no { font-size: 11px; font-weight: 900; color: #0B3B2E; }
    .header-right .doc-date { margin-top: 2px; }

    /* Title */
    .doc-title { text-align: center; margin: 8px 0 6px; }
    .doc-title h1 { font-size: 14px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.06em; color: #0B3B2E; }
    .doc-title .subtitle { font-size: 8px; color: #6b7280; margin-top: 2px; }

    /* Sections */
    .section-title { font-size: 9px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.1em; color: #fff; background: #0B3B2E; padding: 3px 6px; margin: 8px 0 4px; }

    /* Two-column party layout */
    .party-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 4px; }
    .party-box { border: 1px solid #d1d5db; border-radius: 3px; padding: 6px 8px; }
    .party-box .party-label { font-size: 7.5px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.1em; color: #6b7280; margin-bottom: 4px; }
    .party-box .party-name { font-size: 11px; font-weight: 900; color: #111827; }
    .party-box table { width: 100%; border-collapse: collapse; margin-top: 4px; }
    .party-box table td { font-size: 8.5px; padding: 1px 0; vertical-align: top; }
    .party-box table td:first-child { color: #6b7280; width: 70px; }

    /* Details table */
    .details-table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
    .details-table tr { border-bottom: 1px solid #f3f4f6; }
    .details-table td { padding: 3px 5px; font-size: 9px; vertical-align: top; }
    .details-table td.label { width: 160px; font-weight: 700; color: #374151; background: #f9fafb; }
    .details-table td.value { color: #111827; }

    /* Highlight boxes */
    .rent-block { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin: 6px 0; }
    .rent-box { border: 1px solid #d1d5db; border-radius: 3px; padding: 5px 8px; text-align: center; }
    .rent-box .box-label { font-size: 7.5px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; }
    .rent-box .box-value { font-size: 14px; font-weight: 900; color: #0B3B2E; margin-top: 1px; }
    .rent-box .box-sub { font-size: 7.5px; color: #6b7280; margin-top: 1px; }

    /* Standard clauses */
    .clauses { margin-top: 4px; }
    .clause { margin-bottom: 5px; }
    .clause-num { display: inline-block; font-weight: 900; color: #0B3B2E; min-width: 18px; font-size: 9px; }
    .clause-text { font-size: 8.5px; color: #374151; display: inline; }

    .terms-text { font-size: 8.5px; color: #374151; white-space: pre-wrap; border: 1px solid #e5e7eb; padding: 6px 8px; border-radius: 3px; margin-bottom: 4px; }

    /* Signatures */
    .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 10px; }
    .sig-block { border-top: 1px solid #374151; padding-top: 6px; }
    .sig-block .sig-role { font-size: 8px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; margin-bottom: 18px; }
    .sig-block .sig-line { border-top: 1px solid #9ca3af; margin: 4px 0; }
    .sig-block .sig-label { font-size: 7.5px; color: #9ca3af; }

    .footer { margin-top: 12px; padding-top: 6px; border-top: 1px solid #e5e7eb; font-size: 7px; color: #9ca3af; text-align: center; }

    table.details-table { border: 1px solid #e5e7eb; }
  </style>
</head>
<body>
<div class="sheet">

  <!-- HEADER -->
  <div class="header">
    <div class="brand">
      ${businessLogo
        ? `<img src="${esc(businessLogo)}" alt="logo" class="brand-logo"/>`
        : `<div class="brand-fallback">${esc((business.companyName || "M").charAt(0).toUpperCase())}</div>`
      }
      <div class="brand-info">
        <div class="name">${businessName}</div>
        ${businessSlogan ? `<div class="slogan">${businessSlogan}</div>` : ""}
        <div class="contact">
          ${businessPostal ? `P.O. Box ${businessPostal}` : ""}
          ${businessAddr ? (businessPostal ? " &bull; " : "") + businessAddr : ""}
        </div>
        <div class="contact">
          ${businessPhone ? `Tel: ${businessPhone}` : ""}
          ${businessPhone && businessEmail ? " &bull; " : ""}
          ${businessEmail ? `Email: ${businessEmail}` : ""}
        </div>
      </div>
    </div>
    <div class="header-right">
      <div class="doc-no">AGREEMENT NO: ${agreementNo}</div>
      <div class="doc-date">Date Issued: ${generatedDate}</div>
      <div class="doc-date">Status: ${String(lease.status || "").replace(/_/g, " ").toUpperCase()}</div>
    </div>
  </div>

  <!-- TITLE -->
  <div class="doc-title">
    <h1>Tenancy Agreement</h1>
    <div class="subtitle">This agreement is entered into between the parties described below and is binding upon execution by both parties.</div>
  </div>

  <!-- PARTIES -->
  <div class="section-title">Parties to this Agreement</div>
  <div class="party-grid">
    <div class="party-box">
      <div class="party-label">Landlord / Letting Agent</div>
      <div class="party-name">${businessName}</div>
      <table>
        ${landlordName !== "—" ? `<tr><td>Landlord:</td><td>${landlordName}</td></tr>` : ""}
        ${landlordPhone !== "—" ? `<tr><td>Phone:</td><td>${landlordPhone}</td></tr>` : ""}
        ${landlordEmail !== "—" ? `<tr><td>Email:</td><td>${landlordEmail}</td></tr>` : ""}
        ${businessPhone ? `<tr><td>Office Tel:</td><td>${businessPhone}</td></tr>` : ""}
        ${businessEmail ? `<tr><td>Office Email:</td><td>${businessEmail}</td></tr>` : ""}
      </table>
    </div>
    <div class="party-box">
      <div class="party-label">Tenant</div>
      <div class="party-name">${tenantName}</div>
      <table>
        ${tenantCode ? `<tr><td>Account No:</td><td>${tenantCode}</td></tr>` : ""}
        <tr><td>ID/Passport:</td><td>${tenantId}</td></tr>
        <tr><td>Phone:</td><td>${tenantPhone}</td></tr>
        ${tenantEmail !== "—" ? `<tr><td>Email:</td><td>${tenantEmail}</td></tr>` : ""}
      </table>
    </div>
  </div>

  <!-- PREMISES -->
  <div class="section-title">Premises</div>
  <table class="details-table">
    <tr><td class="label">Property</td><td class="value">${propertyLine}</td></tr>
    <tr><td class="label">Unit / Premises</td><td class="value">${unitNumber}</td></tr>
  </table>

  <!-- LEASE TERMS -->
  <div class="section-title">Lease Terms</div>
  <table class="details-table">
    <tr><td class="label">Lease Type</td><td class="value">${leaseType}</td></tr>
    <tr><td class="label">Commencement Date</td><td class="value">${startDate}</td></tr>
    <tr><td class="label">Expiry / End Date</td><td class="value">${endDate}</td></tr>
    <tr><td class="label">Billing Period</td><td class="value">${billing}</td></tr>
    <tr><td class="label">Payment Due Day</td><td class="value">Day ${dueDay} of each billing period</td></tr>
    <tr><td class="label">Notice Period</td><td class="value">${noticeDays} days written notice required by either party</td></tr>
    ${lateFeeRow}
  </table>

  <!-- FINANCIALS -->
  <div class="section-title">Financial Summary</div>
  <div class="rent-block">
    <div class="rent-box">
      <div class="box-label">Monthly Rent</div>
      <div class="box-value">KES ${rentAmount}</div>
      <div class="box-sub">Due on day ${dueDay}</div>
    </div>
    <div class="rent-box">
      <div class="box-label">Security Deposit</div>
      <div class="box-value">KES ${depositAmount}</div>
      <div class="box-sub">Payable at signing</div>
    </div>
    <div class="rent-box">
      <div class="box-label">Total Due at Signing</div>
      <div class="box-value">KES ${fmt(Number(lease.rentAmount || 0) + Number(lease.depositAmount || 0))}</div>
      <div class="box-sub">1st month + deposit</div>
    </div>
  </div>

  <!-- STANDARD CLAUSES -->
  <div class="section-title">Standard Terms &amp; Conditions</div>
  <div class="clauses">
    <div class="clause"><span class="clause-num">1.</span><span class="clause-text"><strong>Rent Payment.</strong> Rent shall be paid in full on or before day ${dueDay} of each ${billing.toLowerCase()} billing period. Acceptable payment methods include mobile money, bank transfer, or any other method agreed in writing with the landlord.</span></div>
    <div class="clause"><span class="clause-num">2.</span><span class="clause-text"><strong>Security Deposit.</strong> The tenant has paid a security deposit of KES ${depositAmount}. This deposit shall be held as security for the faithful performance of all tenant obligations and shall be refunded within 30 days of the end of the tenancy, less any lawful deductions for arrears or damages.</span></div>
    <div class="clause"><span class="clause-num">3.</span><span class="clause-text"><strong>Use of Premises.</strong> The tenant shall use the premises solely for residential (or agreed commercial) purposes and shall not sublet or assign without prior written consent of the landlord.</span></div>
    <div class="clause"><span class="clause-num">4.</span><span class="clause-text"><strong>Utilities &amp; Services.</strong> The tenant shall be responsible for payments of all utilities consumed at the premises (water, electricity, garbage, etc.) unless otherwise agreed in writing.</span></div>
    <div class="clause"><span class="clause-num">5.</span><span class="clause-text"><strong>Maintenance &amp; Repairs.</strong> The tenant shall maintain the premises in a clean and sanitary condition and shall promptly notify the landlord of any damage. The tenant shall be liable for damages caused by negligence or misuse.</span></div>
    <div class="clause"><span class="clause-num">6.</span><span class="clause-text"><strong>Access &amp; Inspection.</strong> The landlord or their agent may enter the premises for inspection, repairs, or showing with at least 24 hours prior notice, except in cases of emergency.</span></div>
    <div class="clause"><span class="clause-num">7.</span><span class="clause-text"><strong>Termination.</strong> Either party may terminate this agreement by giving ${noticeDays} days' written notice. In the event of breach, the non-breaching party may terminate with shorter notice as provided by law.</span></div>
    <div class="clause"><span class="clause-num">8.</span><span class="clause-text"><strong>Alterations.</strong> The tenant shall not make any structural alterations, additions, or improvements to the premises without the prior written consent of the landlord.</span></div>
    <div class="clause"><span class="clause-num">9.</span><span class="clause-text"><strong>Governing Law.</strong> This agreement shall be governed by the laws of the Republic of Kenya and any disputes shall be resolved through mediation or in a court of competent jurisdiction.</span></div>
  </div>

  ${termsSection}

  <!-- SIGNATURES -->
  <div class="section-title">Execution</div>
  <p style="font-size:8.5px; color:#374151; margin-bottom:8px;">
    By signing below, both parties confirm that they have read, understood, and agree to be bound by all terms and conditions of this Tenancy Agreement.
  </p>
  <div class="sig-grid">
    <div class="sig-block">
      <div class="sig-role">Landlord / Authorized Agent</div>
      <div class="sig-line"></div>
      <div class="sig-label">Signature &amp; Date</div>
      <div style="margin-top:6px; font-size:8.5px; color:#374151;">
        <strong>${businessName}</strong><br/>
        ${landlordName !== "—" ? landlordName : ""}
      </div>
    </div>
    <div class="sig-block">
      <div class="sig-role">Tenant</div>
      <div class="sig-line"></div>
      <div class="sig-label">Signature &amp; Date</div>
      <div style="margin-top:6px; font-size:8.5px; color:#374151;">
        <strong>${tenantName}</strong><br/>
        ID/Passport: ${tenantId}
      </div>
    </div>
  </div>

  <div class="footer">
    Agreement No: ${agreementNo} &bull; Generated by ${businessName} via Milik PMS &bull; ${generatedDate}
  </div>

</div>
</body>
</html>`;
};

export const generateLeasePdf = async (lease) => {
  const html = buildHtml(lease);

  await acquireSlot();
  let page = null;
  try {
    page = await createPage();

    await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1 });
    page.setDefaultNavigationTimeout(30_000);
    page.setDefaultTimeout(30_000);

    await page.setContent(html, { waitUntil: "domcontentloaded" });

    const pdfBuffer = await withTimeout(
      page.pdf({
        format: "A4",
        landscape: false,
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: "15mm", right: "14mm", bottom: "15mm", left: "14mm" },
      }),
      RENDER_TIMEOUT_MS,
      "Lease PDF render timed out"
    );

    return Buffer.from(pdfBuffer);
  } catch (error) {
    await resetBrowser();
    throw error;
  } finally {
    if (page) {
      try { await page.close(); } catch { /* ignore */ }
    }
    releaseSlot();
  }
};

export default { generateLeasePdf };
