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

const fmtDate = (v) =>
  v ? new Date(v).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" }) : "—";

const withTimeout = (promise, ms, message) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
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
  const map = {
    monthly: "Monthly", bimonthly: "Bi-Monthly", quarterly: "Quarterly",
    annually: "Annual", weekly: "Weekly", daily: "Daily",
  };
  return map[String(key).toLowerCase()] || key || "Monthly";
};

const sec = (label) =>
  `<div class="sec-head"><div class="sec-label">${label}</div><div class="sec-rule"></div></div>`;

const buildHtml = (lease) => {
  const business  = lease.business  || {};
  const tenant    = lease.tenant    || {};
  const unit      = lease.unit      || {};
  const property  = unit.property   || {};
  const landlord  = lease.landlord  || {};

  const businessName   = esc(business.companyName || business.name || "Milik");
  const businessSlogan = esc(business.slogan || "");
  const businessLogo   = business.logo || "";
  const businessAddr   = esc(buildAddress(business));
  const businessPostal = esc(business.postalAddress || business.POBOX || "");
  const businessPhone  = esc(business.phoneNo || business.phone || "");
  const businessEmail  = esc(business.email || "");

  const tenantName  = esc(tenant.name      || "—");
  const tenantId    = esc(tenant.idNumber  || "—");
  const tenantPhone = esc(tenant.phone     || "—");
  const tenantEmail = esc(tenant.email     || "—");
  const tenantCode  = esc(tenant.tenantCode || "");

  const unitNumber   = esc(unit.unitNumber || unit.unitName || unit.name || "—");
  const propertyName = esc(property.propertyName || property.name || "—");
  const propertyCode = esc(property.propertyCode || "");
  const propertyAddr = esc(property.address || "");

  const landlordName  = esc(landlord.landlordName  || "—");
  const landlordPhone = esc(landlord.phoneNumber   || "—");
  const landlordEmail = esc(landlord.email         || "—");

  const agreementNo = esc(lease.agreementNumber || "—");
  const leaseType   = lease.leaseType === "at_will" ? "Month-to-Month (At Will)" : "Fixed Term";
  const startDate   = fmtDate(lease.startDate);
  const endDate     = lease.leaseType === "at_will" ? "Ongoing (At Will)" : fmtDate(lease.endDate);
  const rentAmount  = fmt(lease.rentAmount);
  const depositAmt  = fmt(lease.depositAmount);
  const totalDue    = fmt(Number(lease.rentAmount || 0) + Number(lease.depositAmount || 0));
  const dueDay      = lease.paymentDueDay  || 5;
  const billing     = billingLabel(lease.billingPeriodKey);
  const noticeDays  = lease.noticePeriodDays || 30;
  const lateFee     = Number(lease.lateFee || 0);
  const terms       = esc(lease.terms || "");
  const generatedDate = fmtDate(new Date());
  const statusText  = String(lease.status || "active").replace(/_/g, " ").toUpperCase();

  const propertyLine = propertyCode
    ? `${propertyCode} — ${propertyName}${propertyAddr ? `, ${propertyAddr}` : ""}`
    : `${propertyName}${propertyAddr ? `, ${propertyAddr}` : ""}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Tenancy Agreement — ${agreementNo}</title>
<style>
  @page {
    size: A4 portrait;
    margin: 16mm 15mm 18mm 15mm;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 8.8pt;
    color: #1a1a2e;
    background: #fff;
    line-height: 1.55;
  }

  /* ── ACCENT BAR ── */
  .accent { height: 4px; background: linear-gradient(90deg, #0B3B2E 0%, #16855e 65%, #c9a227 100%); margin-bottom: 9px; }

  /* ── HEADER ── */
  .hdr {
    display: flex; align-items: flex-start; justify-content: space-between;
    padding-bottom: 9px; border-bottom: 2px solid #0B3B2E; margin-bottom: 9px;
  }
  .brand { display: flex; align-items: center; gap: 10px; }
  .logo-img { width: 52px; height: 52px; object-fit: contain; border-radius: 3px; }
  .logo-fb {
    width: 52px; height: 52px; border-radius: 4px;
    background: #0B3B2E; color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-size: 23px; font-weight: 900; letter-spacing: -1px;
  }
  .bname   { font-size: 15.5pt; font-weight: 900; color: #0B3B2E; line-height: 1.1; }
  .bslogan { font-size: 6.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; margin-top: 2px; }
  .bcontact{ font-size: 7.5pt; color: #374151; margin-top: 3px; }
  .hdr-meta { text-align: right; }
  .doc-badge {
    display: inline-block; background: #0B3B2E; color: #fff;
    font-size: 8pt; font-weight: 900; padding: 3px 9px; border-radius: 3px;
    letter-spacing: 0.04em; margin-bottom: 5px;
  }
  .meta-row { font-size: 7.5pt; color: #374151; margin-top: 2px; }
  .meta-row strong { color: #111; }

  /* ── TITLE ── */
  .title-block {
    text-align: center; padding: 8px 0; margin-bottom: 8px;
    border-top: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb;
  }
  .title-block h1 {
    font-size: 13.5pt; font-weight: 900; text-transform: uppercase;
    letter-spacing: 0.13em; color: #0B3B2E;
  }
  .title-sub { font-size: 7pt; color: #6b7280; margin-top: 3px; line-height: 1.4; max-width: 420px; margin-left: auto; margin-right: auto; }

  /* ── SECTION HEADERS ── */
  .sec-head { display: flex; align-items: center; gap: 6px; margin: 9px 0 4px; page-break-after: avoid; }
  .sec-label {
    font-size: 6.5pt; font-weight: 900; text-transform: uppercase;
    letter-spacing: 0.14em; color: #0B3B2E; white-space: nowrap;
    border-left: 3px solid #0B3B2E; padding-left: 6px;
  }
  .sec-rule { flex: 1; height: 1px; background: #d1d5db; }

  /* ── PARTY GRID ── */
  .party-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 2px; }
  .party-box {
    border: 1px solid #d1fae5; border-top: 2.5px solid #0B3B2E;
    border-radius: 3px; padding: 7px 9px; background: #f9fffd;
  }
  .p-role { font-size: 6.5pt; font-weight: 900; text-transform: uppercase; letter-spacing: 0.12em; color: #059669; margin-bottom: 3px; }
  .p-name { font-size: 10pt; font-weight: 900; color: #111827; margin-bottom: 4px; line-height: 1.2; }
  .ptab { width: 100%; border-collapse: collapse; }
  .ptab td { font-size: 7.8pt; padding: 1.5px 0; vertical-align: top; }
  .ptab td:first-child { color: #6b7280; width: 78px; font-size: 7.2pt; }

  /* ── DETAILS TABLE ── */
  .dtab { width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; margin-bottom: 2px; }
  .dtab tr { border-bottom: 1px solid #f3f4f6; }
  .dtab tr:last-child { border-bottom: none; }
  .dtab td { padding: 3.5px 7px; font-size: 8.3pt; vertical-align: top; }
  .dtab .lbl { width: 155px; font-weight: 700; color: #374151; background: #f8fafc; border-right: 1px solid #e5e7eb; }

  /* ── FINANCIAL BOXES ── */
  .fin-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; margin: 3px 0 2px; }
  .fin-box { border: 1px solid #e5e7eb; border-radius: 4px; padding: 7px 8px; text-align: center; background: #fafafa; }
  .fin-box.hi { background: #f0fdf4; border-color: #6ee7b7; border-top: 2px solid #0B3B2E; }
  .fb-label { font-size: 6.5pt; font-weight: 900; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; }
  .fb-val { font-size: 12.5pt; font-weight: 900; color: #0B3B2E; margin: 3px 0 2px; line-height: 1; }
  .fb-sub { font-size: 7pt; color: #9ca3af; }

  /* ── CLAUSES ── */
  .clause {
    display: flex; gap: 7px; margin-bottom: 5.5px;
    page-break-inside: avoid;
  }
  .cn { flex-shrink: 0; width: 17px; font-size: 8pt; font-weight: 900; color: #0B3B2E; padding-top: 0.5px; }
  .ct { font-size: 8pt; color: #374151; line-height: 1.52; }
  .ct strong { color: #111827; }

  /* ── SPECIAL TERMS BOX ── */
  .terms-box {
    border: 1px solid #e5e7eb; border-left: 3px solid #d97706;
    border-radius: 3px; padding: 7px 9px;
    font-size: 8pt; color: #374151; white-space: pre-wrap; line-height: 1.5;
    background: #fffbeb; margin-bottom: 4px;
    page-break-inside: avoid;
  }

  /* ── DECLARATION ── */
  .declaration {
    border: 1px solid #e5e7eb; border-radius: 3px; padding: 7px 9px;
    font-size: 8pt; color: #374151; background: #f9fafb;
    margin-bottom: 10px; page-break-inside: avoid;
    line-height: 1.5;
  }

  /* ── SIGNATURES ── */
  .sig-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }
  .sig-block { page-break-inside: avoid; }
  .sig-role {
    font-size: 6.5pt; font-weight: 900; text-transform: uppercase;
    letter-spacing: 0.12em; color: #059669; margin-bottom: 22px;
  }
  .sig-line   { border-bottom: 1.5px solid #374151; margin-bottom: 4px; }
  .sig-name   { font-size: 8.5pt; font-weight: 700; color: #111827; }
  .sig-sub    { font-size: 7.5pt; color: #6b7280; margin-top: 1px; }
  .sig-field  { border-bottom: 1px solid #9ca3af; margin-top: 9px; padding-bottom: 1px; min-height: 14px; }
  .sig-flabel { font-size: 6.5pt; color: #9ca3af; margin-top: 2px; }

  /* ── STAMP CIRCLE ── */
  .stamp {
    width: 66px; height: 66px; border-radius: 50%;
    border: 1.5px dashed #d1d5db;
    display: flex; align-items: center; justify-content: center;
    font-size: 5.5pt; color: #d1d5db; text-align: center; line-height: 1.4;
    margin: 10px auto 0;
  }

  /* ── HELPERS ── */
  .no-break { page-break-inside: avoid; }
</style>
</head>
<body>

<div class="accent"></div>

<!-- HEADER -->
<div class="hdr">
  <div class="brand">
    ${businessLogo
      ? `<img src="${esc(businessLogo)}" alt="${businessName}" class="logo-img"/>`
      : `<div class="logo-fb">${esc((business.companyName || business.name || "M").charAt(0).toUpperCase())}</div>`
    }
    <div>
      <div class="bname">${businessName}</div>
      ${businessSlogan ? `<div class="bslogan">${businessSlogan}</div>` : ""}
      <div class="bcontact">
        ${businessPostal ? `P.O. Box ${businessPostal}` : ""}
        ${businessAddr   ? (businessPostal ? " &bull; " : "") + businessAddr : ""}
      </div>
      <div class="bcontact">
        ${businessPhone ? `Tel: ${businessPhone}` : ""}
        ${businessPhone && businessEmail ? " &bull; " : ""}
        ${businessEmail ? businessEmail : ""}
      </div>
    </div>
  </div>
  <div class="hdr-meta">
    <div class="doc-badge">AGREEMENT NO: ${agreementNo}</div>
    <div class="meta-row">Date Issued: <strong>${generatedDate}</strong></div>
    <div class="meta-row">Lease Type: <strong>${leaseType}</strong></div>
    <div class="meta-row">Status: <strong>${statusText}</strong></div>
  </div>
</div>

<!-- TITLE -->
<div class="title-block">
  <h1>Tenancy Agreement</h1>
  <div class="title-sub">This agreement is made between the parties named below and shall be legally binding upon execution by all signatories hereto.</div>
</div>

<!-- PARTIES -->
${sec("Parties to this Agreement")}
<div class="party-grid no-break">
  <div class="party-box">
    <div class="p-role">Landlord / Letting Agent</div>
    <div class="p-name">${businessName}</div>
    <table class="ptab">
      ${landlordName !== "—" ? `<tr><td>Landlord:</td><td>${landlordName}</td></tr>` : ""}
      ${landlordPhone !== "—" ? `<tr><td>Phone:</td><td>${landlordPhone}</td></tr>` : ""}
      ${landlordEmail !== "—" ? `<tr><td>Email:</td><td>${landlordEmail}</td></tr>` : ""}
      ${businessPhone ? `<tr><td>Office Tel:</td><td>${businessPhone}</td></tr>` : ""}
      ${businessEmail ? `<tr><td>Office Email:</td><td>${businessEmail}</td></tr>` : ""}
      ${businessAddr  ? `<tr><td>Address:</td><td>${businessAddr}</td></tr>` : ""}
    </table>
  </div>
  <div class="party-box">
    <div class="p-role">Tenant</div>
    <div class="p-name">${tenantName}</div>
    <table class="ptab">
      ${tenantCode ? `<tr><td>Account No:</td><td>${tenantCode}</td></tr>` : ""}
      <tr><td>ID / Passport:</td><td>${tenantId}</td></tr>
      <tr><td>Phone:</td><td>${tenantPhone}</td></tr>
      ${tenantEmail !== "—" ? `<tr><td>Email:</td><td>${tenantEmail}</td></tr>` : ""}
    </table>
  </div>
</div>

<!-- PREMISES -->
${sec("Premises")}
<table class="dtab no-break">
  <tr><td class="lbl">Property</td><td>${propertyLine}</td></tr>
  <tr><td class="lbl">Unit / Premises</td><td>${unitNumber}</td></tr>
</table>

<!-- LEASE TERMS -->
${sec("Lease Terms")}
<table class="dtab no-break">
  <tr><td class="lbl">Lease Type</td><td>${leaseType}</td></tr>
  <tr><td class="lbl">Commencement Date</td><td>${startDate}</td></tr>
  <tr><td class="lbl">Expiry / End Date</td><td>${endDate}</td></tr>
  <tr><td class="lbl">Billing Period</td><td>${billing}</td></tr>
  <tr><td class="lbl">Payment Due Day</td><td>Day ${dueDay} of each billing period</td></tr>
  <tr><td class="lbl">Notice Period</td><td>${noticeDays} days written notice required by either party to vacate</td></tr>
  ${lateFee > 0 ? `<tr><td class="lbl">Late Payment Fee</td><td>KES ${fmt(lateFee)} per billing period after the due date</td></tr>` : ""}
</table>

<!-- FINANCIALS -->
${sec("Financial Summary")}
<div class="fin-grid no-break">
  <div class="fin-box">
    <div class="fb-label">${billing} Rent</div>
    <div class="fb-val">KES ${rentAmount}</div>
    <div class="fb-sub">Due on day ${dueDay}</div>
  </div>
  <div class="fin-box">
    <div class="fb-label">Security Deposit</div>
    <div class="fb-val">KES ${depositAmt}</div>
    <div class="fb-sub">Payable at signing</div>
  </div>
  <div class="fin-box hi">
    <div class="fb-label">Total Due at Signing</div>
    <div class="fb-val">KES ${totalDue}</div>
    <div class="fb-sub">1st month + deposit</div>
  </div>
</div>

<!-- STANDARD CLAUSES -->
${sec("Standard Terms &amp; Conditions")}

<div class="clause">
  <div class="cn">1.</div>
  <div class="ct"><strong>Rent Payment.</strong> Rent of KES ${rentAmount} shall be paid in full on or before day ${dueDay} of each ${billing.toLowerCase()} billing period without demand. Acceptable payment methods include mobile money transfer, bank transfer, cheque, or any other method agreed in writing with the landlord or agent. Time is of the essence.${lateFee > 0 ? ` A late payment fee of KES ${fmt(lateFee)} shall be charged for each billing period in which rent remains unpaid after the due date.` : ""}</div>
</div>

<div class="clause">
  <div class="cn">2.</div>
  <div class="ct"><strong>Security Deposit.</strong> A security deposit of KES ${depositAmt} has been paid by the tenant and shall be held by the landlord as security for faithful performance of all obligations herein. The deposit shall be refunded within thirty (30) days of termination of tenancy, less any lawful deductions for unpaid rent, outstanding utility balances, or damages beyond fair wear and tear. No interest shall accrue on the deposit unless otherwise agreed in writing.</div>
</div>

<div class="clause">
  <div class="cn">3.</div>
  <div class="ct"><strong>Use of Premises.</strong> The tenant shall use and occupy the premises solely for the purpose agreed at signing and shall not sublet, assign, or permit any other person to occupy or share the premises without the prior written consent of the landlord. Unauthorized subletting or assignment shall constitute a fundamental breach of this agreement and grounds for immediate termination.</div>
</div>

<div class="clause">
  <div class="cn">4.</div>
  <div class="ct"><strong>Utilities &amp; Services.</strong> Unless otherwise agreed in writing, the tenant shall be solely responsible for the prompt payment of all utilities and services consumed at the premises, including water, electricity, internet, garbage collection, and any service charges levied by the relevant authority or management company. Failure to pay utilities shall not relieve the tenant of the obligation to pay rent.</div>
</div>

<div class="clause">
  <div class="cn">5.</div>
  <div class="ct"><strong>Maintenance &amp; Care of Premises.</strong> The tenant shall maintain the premises and all fixtures, fittings, and installations in a clean, sanitary, and good condition throughout the tenancy. The tenant shall promptly notify the landlord in writing of any defects, damage, or required repairs. The tenant shall bear the cost of repairing damage caused by negligence, misuse, or wilful act of the tenant, household members, or guests.</div>
</div>

<div class="clause">
  <div class="cn">6.</div>
  <div class="ct"><strong>Access &amp; Inspection.</strong> The landlord or their duly authorised agent shall be entitled to enter and inspect the premises at reasonable times upon giving at least twenty-four (24) hours' notice to the tenant. In the event of an emergency threatening life or property, the landlord or agent may enter without prior notice. The tenant shall facilitate access for scheduled maintenance, repairs, or permitted viewings.</div>
</div>

<div class="clause">
  <div class="cn">7.</div>
  <div class="ct"><strong>Alterations &amp; Improvements.</strong> The tenant shall not make or permit any structural alterations, additions, or improvements to the premises, or erect any permanent fixtures, without the prior written approval of the landlord. Any approved alterations shall, unless otherwise agreed in writing, become the property of the landlord upon vacation and shall not be removed by the tenant.</div>
</div>

<div class="clause">
  <div class="cn">8.</div>
  <div class="ct"><strong>Nuisance &amp; Conduct.</strong> The tenant shall not cause or permit nuisance, annoyance, or unreasonable disturbance to neighbouring occupants or the general public. The premises shall not be used for any unlawful purpose or in contravention of any applicable law or by-law. Excessive noise between the hours of 10:00 p.m. and 6:00 a.m. is strictly prohibited.</div>
</div>

<div class="clause">
  <div class="cn">9.</div>
  <div class="ct"><strong>Pets &amp; Animals.</strong> No animals, birds, or pets of any kind shall be kept or harboured at the premises without the prior written consent of the landlord. Where consent is granted, the tenant shall be liable for any damage caused by the animal and shall keep the premises free from odour, pest infestation, or health risk attributable to the keeping of such animal.</div>
</div>

<div class="clause">
  <div class="cn">10.</div>
  <div class="ct"><strong>Insurance.</strong> The landlord shall maintain insurance over the structure of the premises where applicable. The tenant is strongly advised to obtain contents and personal liability insurance at their own expense. The landlord shall not be liable for loss of or damage to the tenant's personal property howsoever arising, unless caused by the landlord's proven negligence.</div>
</div>

<div class="clause">
  <div class="cn">11.</div>
  <div class="ct"><strong>Termination &amp; Notice.</strong> Either party may terminate this agreement by giving not less than ${noticeDays} days' written notice to the other party. Notice shall be delivered in writing by hand, registered post, or an agreed digital channel and shall state the intended date of vacation. In the event of a material breach, the non-breaching party may terminate with shorter notice as permitted by law, after serving a notice to remedy where appropriate.</div>
</div>

<div class="clause">
  <div class="cn">12.</div>
  <div class="ct"><strong>Default &amp; Remedies.</strong> Should the tenant fail to pay rent within fourteen (14) days after the due date, or commit any other material breach, the landlord shall be entitled to serve a written notice to remedy. If the breach is not remedied within the period stated in the notice, the landlord may terminate the tenancy and institute legal proceedings for recovery of arrears and possession of the premises, without prejudice to any other remedy available at law.</div>
</div>

<div class="clause">
  <div class="cn">13.</div>
  <div class="ct"><strong>Vacation of Premises.</strong> Upon expiry or lawful termination of this agreement, the tenant shall peaceably vacate the premises, remove all personal property, and return all keys and access devices to the landlord in good working condition. The premises shall be left in a clean and tidy state, reasonably comparable to the condition at commencement, allowing for fair wear and tear. Any items left behind may be disposed of by the landlord at the tenant's cost.</div>
</div>

<div class="clause">
  <div class="cn">14.</div>
  <div class="ct"><strong>Governing Law &amp; Disputes.</strong> This agreement shall be governed by and construed in accordance with the laws of the Republic of Kenya, including the Landlord and Tenant (Shops, Hotels and Catering Establishments) Act (Cap. 301) and the Rent Restriction Act (Cap. 296) where applicable. Any dispute arising out of or in connection with this agreement shall first be referred to good-faith mediation. If unresolved, the parties consent to the jurisdiction of the Kenyan courts of competent jurisdiction.</div>
</div>

${terms ? `
${sec("Special Terms &amp; Conditions")}
<div class="terms-box">${terms.replace(/\n/g, "<br/>")}</div>
` : ""}

<!-- SIGNATURES -->
${sec("Execution &amp; Signatures")}
<div class="declaration">
  By signing below, each party confirms that they have read and fully understood all terms and conditions of this Tenancy Agreement and agree to be bound by them. This document constitutes a legally binding contract upon execution by all signatories.
</div>

<div class="sig-grid">
  <div class="sig-block">
    <div class="sig-role">Landlord / Authorised Agent</div>
    <div class="sig-line"></div>
    <div class="sig-name">${businessName}</div>
    <div class="sig-sub">${landlordName !== "—" ? landlordName : "&nbsp;"}</div>
    <div class="sig-field"></div>
    <div class="sig-flabel">Date</div>
    <div class="stamp">OFFICIAL<br/>STAMP<br/>(if applicable)</div>
  </div>
  <div class="sig-block">
    <div class="sig-role">Tenant</div>
    <div class="sig-line"></div>
    <div class="sig-name">${tenantName}</div>
    <div class="sig-sub">ID / Passport: ${tenantId}</div>
    <div class="sig-field"></div>
    <div class="sig-flabel">Date</div>
    <div class="stamp">TENANT<br/>THUMBPRINT<br/>(if applicable)</div>
  </div>
  <div class="sig-block">
    <div class="sig-role">Witness</div>
    <div class="sig-line"></div>
    <div class="sig-name">&nbsp;</div>
    <div class="sig-sub">&nbsp;</div>
    <div class="sig-field"></div>
    <div class="sig-flabel">Full Name</div>
    <div class="sig-field" style="margin-top:6px;"></div>
    <div class="sig-flabel">ID / Passport No.</div>
    <div class="sig-field" style="margin-top:6px;"></div>
    <div class="sig-flabel">Date</div>
  </div>
</div>

</body>
</html>`;
};

export const generateLeasePdf = async (lease) => {
  const html = buildHtml(lease);

  const agreementNo   = String(lease.agreementNumber || "—").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const businessName  = String((lease.business || {}).companyName || (lease.business || {}).name || "Milik").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const generatedDate = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });

  const footerTemplate = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:7px;color:#9ca3af;width:100%;padding:0 15mm;box-sizing:border-box;display:flex;justify-content:space-between;align-items:center;border-top:1px solid #e5e7eb;">
    <span>Agreement No: ${agreementNo}</span>
    <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span> &bull; Confidential</span>
    <span>${businessName} via Milik PMS &bull; ${generatedDate}</span>
  </div>`;

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
        displayHeaderFooter: true,
        headerTemplate: `<div></div>`,
        footerTemplate,
        margin: { top: "16mm", right: "15mm", bottom: "18mm", left: "15mm" },
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
