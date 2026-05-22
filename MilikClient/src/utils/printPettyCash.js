const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const GRN = "#0B3B2E";

const co = (company = {}) => ({
  name: company?.companyName || company?.name || "MILIK PROPERTY MANAGEMENT",
  logo: company?.logo || "",
  phone: company?.phone || company?.phoneNo || company?.phoneNumber || company?.mobile || company?.contactPhone || "",
  email: company?.email || company?.companyEmail || company?.contactEmail || "",
  address: [company?.address || company?.postalAddress || company?.location || "", company?.town || company?.city || ""].filter(Boolean).join(", "),
});

const dt = (d) =>
  d ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "long", year: "numeric" }) : "—";

const fmt = (n) =>
  `KES ${Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

const _toW = (n) => {
  if (n === 0) return "";
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
  if (n < 1000) return ONES[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + _toW(n % 100) : "");
  if (n < 1_000_000) return _toW(Math.floor(n / 1000)) + " Thousand" + (n % 1000 ? " " + _toW(n % 1000) : "");
  if (n < 1_000_000_000) return _toW(Math.floor(n / 1_000_000)) + " Million" + (n % 1_000_000 ? " " + _toW(n % 1_000_000) : "");
  return "Overflow";
};

const inWords = (amount) => {
  const total_cents = Math.round(Number(amount || 0) * 100);
  const sh = Math.floor(total_cents / 100);
  const cts = total_cents % 100;
  const base = sh === 0 ? "Zero" : _toW(sh);
  return base + " Kenya Shillings" + (cts > 0 ? " and " + _toW(cts) + " Cents" : "") + " Only";
};

const CATEGORY_LABELS = {
  maintenance: "Maintenance & Repairs",
  cleaning: "Cleaning Supplies",
  security: "Security",
  transport: "Transport & Fuel",
  office_supplies: "Office Supplies",
  utilities: "Utilities (Common Areas)",
  garden: "Garden & Grounds",
  staff_welfare: "Staff Welfare",
  miscellaneous: "Miscellaneous",
};

const openPrint = (html, title) => {
  const win = window.open("", "_blank", "width=1000,height=780");
  if (!win) return null;
  win.document.write(html);
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 500);
  return win;
};

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; background: #fff; }
  .page { max-width: 800px; margin: 0 auto; padding: 32px 36px; }
  .hdr { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; padding-bottom: 16px; margin-bottom: 4px; gap: 16px; }
  .hdr-logo { display: none; }
  .hdr-center { display: flex; flex-direction: column; align-items: center; gap: 5px; text-align: center; }
  .hdr-center img { max-height: 60px; max-width: 150px; object-fit: contain; border-radius: 6px; }
  .hdr-center .fallback { width: 56px; height: 56px; background: ${GRN}; color: #fff; font-size: 22px; font-weight: 900; display: flex; align-items: center; justify-content: center; border-radius: 10px; }
  .co-name { font-size: 18px; font-weight: 900; color: #0f172a; letter-spacing: -.01em; margin-top: 6px; }
  .co-sub { font-size: 10px; color: #64748b; line-height: 1.6; }
  .divider { height: 2px; background: linear-gradient(90deg, #3b82f6, #93c5fd); border-radius: 2px; margin: 16px 0 20px; }
  .doc-title-wrap { text-align: right; align-self: center; }
  .doc-type { font-size: 24px; font-weight: 900; color: #0f172a; letter-spacing: -0.03em; line-height: 1; }
  .doc-no { font-size: 13px; color: #64748b; margin-top: 6px; }
  .doc-date { font-size: 10px; color: #64748b; margin-top: 3px; }
  .section { margin-bottom: 18px; }
  .section-title { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .09em; color: #94a3b8; margin-bottom: 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
  .field-row { display: grid; border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; margin-bottom: 10px; }
  .field-row.two { grid-template-columns: 1fr 1fr; }
  .field-row.three { grid-template-columns: 1fr 1fr 1fr; }
  .field { padding: 9px 12px; border-right: 1px solid #e2e8f0; }
  .field:last-child { border-right: none; }
  .field-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: #94a3b8; margin-bottom: 4px; }
  .field-val { font-size: 12px; font-weight: 600; color: #1e293b; line-height: 1.4; }
  .field-val.mono { font-family: 'Courier New', monospace; font-size: 13px; }
  .amount-box { border: 2px solid ${GRN}; border-radius: 8px; padding: 16px 18px; margin-bottom: 18px; background: #f0faf5; }
  .amount-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .09em; color: #64748b; margin-bottom: 6px; }
  .amount-figures { font-size: 28px; font-weight: 900; color: ${GRN}; font-family: 'Courier New', monospace; letter-spacing: .02em; }
  .amount-words { font-size: 11px; font-style: italic; color: #475569; margin-top: 8px; border-top: 1px dashed #a7f3d0; padding-top: 8px; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 14px; }
  thead th { background: ${GRN}; color: #fff; padding: 8px 10px; font-size: 9px; text-transform: uppercase; letter-spacing: .06em; text-align: left; }
  thead th.right { text-align: right; }
  tbody td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  tbody td.right { text-align: right; font-family: 'Courier New', monospace; }
  tbody tr:nth-child(even) td { background: #f8fafc; }
  tfoot td { padding: 9px 10px; font-weight: 700; border-top: 2px solid ${GRN}; background: #f0faf5; font-size: 11px; }
  tfoot td.right { text-align: right; font-family: 'Courier New', monospace; }
  .summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 18px; }
  .sum-box { border: 1px solid #e2e8f0; border-radius: 6px; padding: 11px 14px; }
  .sum-box.highlight { border-color: ${GRN}; border-width: 2px; background: #f0faf5; }
  .sum-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: #94a3b8; margin-bottom: 5px; }
  .sum-val { font-size: 17px; font-weight: 800; color: ${GRN}; font-family: 'Courier New', monospace; }
  .sum-words { font-size: 9px; font-style: italic; color: #64748b; margin-top: 5px; line-height: 1.4; }
  .sig-section { border-top: 2px solid ${GRN}; padding-top: 20px; margin-top: 28px; }
  .sig-section-title { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .09em; color: #94a3b8; margin-bottom: 18px; }
  .sig-table { display: grid; gap: 20px; }
  .sig-table.three { grid-template-columns: 1fr 1fr 1fr; }
  .sig-table.four { grid-template-columns: 1fr 1fr 1fr 1fr; }
  .sig-block .sig-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: ${GRN}; margin-bottom: 16px; }
  .sig-line { border-bottom: 1.5px solid #94a3b8; margin-bottom: 5px; height: 30px; }
  .sig-sub { font-size: 9px; color: #94a3b8; margin-bottom: 12px; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 9px; font-weight: 700; }
  .badge-ok { background: #dcfce7; color: #166534; }
  .badge-no { background: #fee2e2; color: #991b1b; }
  .void-mark { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-35deg); font-size: 120px; font-weight: 900; color: rgba(220,38,38,.10); z-index: 0; pointer-events: none; letter-spacing: .1em; font-family: Arial, sans-serif; }
  .notice { font-size: 9px; color: #94a3b8; text-align: center; margin-top: 20px; border-top: 1px solid #f1f5f9; padding-top: 12px; line-height: 1.6; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .void-mark { display: block; }
  }
`;

// ─── Petty Cash Voucher ───────────────────────────────────────────────────────

export const printPettyCashVoucher = ({ disbursement, account, company, user }) => {
  if (!disbursement) return null;
  const c = co(company);
  const preparedByName = [user?.otherNames, user?.surname].filter(Boolean).join(' ') || user?.email || 'Milik Admin';
  const isVoid = disbursement.status === "void";
  const coInfo = [c.phone, c.email, c.address].filter(Boolean).join(" • ");

  const expAcct = disbursement.expenseAccountId
    ? `${disbursement.expenseAccountId.code ? disbursement.expenseAccountId.code + " — " : ""}${disbursement.expenseAccountId.name || ""}`
    : "—";
  const propName = disbursement.property?.propertyName || "—";
  const catLabel = CATEGORY_LABELS[disbursement.category] || disbursement.category || "—";

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Petty Cash Voucher — ${escapeHtml(disbursement.voucherNumber)}</title>
  <style>
    ${BASE_CSS}
    @media print { @page { size: A4 portrait; margin: 14mm 12mm; } }
  </style>
</head>
<body>
  ${isVoid ? `<div class="void-mark">VOID</div>` : ""}
  <div class="page">

    <div class="hdr">
      <div></div>
      <div class="hdr-center">
        ${c.logo
          ? `<img src="${escapeHtml(c.logo)}" alt="logo" />`
          : `<div class="fallback">${escapeHtml(c.name.slice(0, 1).toUpperCase())}</div>`}
        <div class="co-name">${escapeHtml(c.name)}</div>
        ${coInfo ? `<div class="co-sub">${escapeHtml(coInfo)}</div>` : ""}
      </div>
      <div class="doc-title-wrap">
        <div class="doc-type">PETTY CASH VOUCHER</div>
        <div class="doc-no"># ${escapeHtml(disbursement.voucherNumber)}</div>
        <div class="doc-date">${dt(disbursement.date)}</div>
      </div>
    </div>
    <div class="divider"></div>

    <div class="section">
      <div class="section-title">Account Details</div>
      <div class="field-row ${account?.custodianName ? "two" : ""}">
        <div class="field">
          <div class="field-label">Petty Cash Account</div>
          <div class="field-val">${escapeHtml(account?.name || "—")}</div>
        </div>
        ${account?.custodianName ? `
        <div class="field">
          <div class="field-label">Custodian</div>
          <div class="field-val">${escapeHtml(account.custodianName)}</div>
        </div>` : ""}
      </div>
    </div>

    <div class="amount-box">
      <div class="amount-label">Amount</div>
      <div class="amount-figures">${fmt(disbursement.amount)}</div>
      <div class="amount-words">${escapeHtml(inWords(disbursement.amount))}</div>
    </div>

    <div class="section">
      <div class="section-title">Expenditure Details</div>
      <div class="field-row">
        <div class="field">
          <div class="field-label">Description / Purpose</div>
          <div class="field-val">${escapeHtml(disbursement.description)}</div>
        </div>
      </div>
      <div class="field-row three">
        <div class="field">
          <div class="field-label">Category</div>
          <div class="field-val">${escapeHtml(catLabel)}</div>
        </div>
        <div class="field">
          <div class="field-label">Property</div>
          <div class="field-val">${escapeHtml(propName)}</div>
        </div>
        <div class="field">
          <div class="field-label">GL Expense Account</div>
          <div class="field-val">${escapeHtml(expAcct)}</div>
        </div>
      </div>
      <div class="field-row two">
        <div class="field">
          <div class="field-label">Receipt</div>
          <div class="field-val">
            ${disbursement.receiptAttached
              ? `<span class="badge badge-ok">&#10003; Attached</span>`
              : `<span class="badge badge-no">&#10007; Not Attached</span>${disbursement.receiptNote ? `&nbsp;&mdash;&nbsp;<em style="font-size:11px;color:#64748b">${escapeHtml(disbursement.receiptNote)}</em>` : ""}`}
          </div>
        </div>
        <div class="field">
          <div class="field-label">Voucher Status</div>
          <div class="field-val" style="color:${isVoid ? "#dc2626" : "#166534"}">${escapeHtml(String(disbursement.status || "active").toUpperCase())}</div>
        </div>
      </div>
      ${isVoid && disbursement.voidReason ? `
      <div class="field-row">
        <div class="field">
          <div class="field-label">Void Reason</div>
          <div class="field-val" style="color:#dc2626">${escapeHtml(disbursement.voidReason)}</div>
        </div>
      </div>` : ""}
    </div>

    <div class="sig-section">
      <div class="sig-section-title">Authorizations</div>
      <div class="sig-table three">
        <div class="sig-block">
          <div class="sig-title">Prepared By</div>
          <div class="sig-line" style="display:flex;align-items:flex-end;padding-bottom:3px;"><span style="font-size:11px;font-weight:700;color:#0f172a;">${escapeHtml(preparedByName)}</span></div>
          <div class="sig-sub">Signature &amp; Date</div>
        </div>
        <div class="sig-block">
          <div class="sig-title">Approved By</div>
          <div class="sig-line"></div>
          <div class="sig-sub">Signature</div>
          <div class="sig-line"></div>
          <div class="sig-sub">Name &amp; Date</div>
        </div>
        <div class="sig-block">
          <div class="sig-title">Received By</div>
          <div class="sig-line"></div>
          <div class="sig-sub">Signature</div>
          <div class="sig-line"></div>
          <div class="sig-sub">Name &amp; Date</div>
        </div>
      </div>
    </div>

    <div class="notice">
      This is an official petty cash voucher generated by ${escapeHtml(c.name)}. Retain for audit purposes.<br />
      Printed on ${new Date().toLocaleDateString("en-KE", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
    </div>
  </div>
</body>
</html>`;

  return openPrint(html, `PCV — ${disbursement.voucherNumber}`);
};

// ─── Replenishment / Imprest Reimbursement Form ───────────────────────────────

export const printReplenishmentSummary = ({ replenishment, disbursements = [], account, company, user }) => {
  if (!replenishment) return null;
  const c = co(company);
  const requestedByName = [user?.otherNames, user?.surname].filter(Boolean).join(' ') || user?.email || 'Milik Admin';
  const coInfo = [c.phone, c.email, c.address].filter(Boolean).join(" • ");

  const activeDisbursements = [...disbursements]
    .filter((d) => d.status !== "void")
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const totalSpent = activeDisbursements.reduce((s, d) => s + Number(d.amount || 0), 0);
  const balanceBefore = Number(replenishment.balanceBeforeReplenishment || 0);
  const repAmount = Number(replenishment.amount || 0);
  const floatAmt = Number(account?.floatAmount || 0);

  const disbRows = activeDisbursements
    .map(
      (d, i) => `
      <tr>
        <td style="text-align:center;color:#94a3b8">${i + 1}</td>
        <td style="font-family:'Courier New',monospace;font-weight:700">${escapeHtml(d.voucherNumber)}</td>
        <td>${dt(d.date)}</td>
        <td>${escapeHtml(d.description)}</td>
        <td>${escapeHtml(CATEGORY_LABELS[d.category] || d.category || "—")}</td>
        <td>${escapeHtml(d.property?.propertyName || "—")}</td>
        <td class="right">${Number(d.amount || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      </tr>`
    )
    .join("");

  const bankAcctName = replenishment.bankAccountId
    ? `${replenishment.bankAccountId.code ? replenishment.bankAccountId.code + " — " : ""}${replenishment.bankAccountId.name || ""}`
    : "—";

  const statusColors = {
    pending: "background:#fef3c7;color:#92400e",
    approved: "background:#dbeafe;color:#1e40af",
    posted: "background:#dcfce7;color:#166534",
    rejected: "background:#fee2e2;color:#991b1b",
  };
  const statusLabel = {
    pending: "PENDING APPROVAL",
    approved: "APPROVED",
    posted: "POSTED TO LEDGER",
    rejected: "REJECTED",
  };
  const st = replenishment.status || "pending";
  const statusBadge = `<span style="display:inline-block;padding:3px 12px;border-radius:999px;font-size:9px;font-weight:700;${statusColors[st] || ""}">${statusLabel[st] || st.toUpperCase()}</span>`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Imprest Reimbursement — ${escapeHtml(replenishment.replenishmentNumber)}</title>
  <style>
    ${BASE_CSS}
    .sig-table.four { grid-template-columns: 1fr 1fr 1fr 1fr; }
    @media print { @page { size: A4 landscape; margin: 12mm 14mm; } }
  </style>
</head>
<body>
  <div class="page">

    <div class="hdr">
      <div></div>
      <div class="hdr-center">
        ${c.logo
          ? `<img src="${escapeHtml(c.logo)}" alt="logo" />`
          : `<div class="fallback">${escapeHtml(c.name.slice(0, 1).toUpperCase())}</div>`}
        <div class="co-name">${escapeHtml(c.name)}</div>
        ${coInfo ? `<div class="co-sub">${escapeHtml(coInfo)}</div>` : ""}
      </div>
      <div class="doc-title-wrap">
        <div class="doc-type">IMPREST REIMBURSEMENT</div>
        <div class="doc-no"># ${escapeHtml(replenishment.replenishmentNumber)}</div>
        <div class="doc-date">${dt(replenishment.requestDate)}</div>
        <div style="margin-top:8px">${statusBadge}</div>
      </div>
    </div>
    <div class="divider"></div>

    <div class="section">
      <div class="section-title">Account Details</div>
      <div class="field-row three">
        <div class="field">
          <div class="field-label">Petty Cash Account</div>
          <div class="field-val">${escapeHtml(account?.name || "—")}</div>
        </div>
        <div class="field">
          <div class="field-label">Custodian</div>
          <div class="field-val">${escapeHtml(account?.custodianName || "—")}</div>
        </div>
        <div class="field">
          <div class="field-label">Float Target</div>
          <div class="field-val mono">${fmt(floatAmt)}</div>
        </div>
      </div>
      <div class="field-row two">
        <div class="field">
          <div class="field-label">Bank / Fund Source</div>
          <div class="field-val">${escapeHtml(bankAcctName)}</div>
        </div>
        <div class="field">
          <div class="field-label">Notes</div>
          <div class="field-val">${escapeHtml(replenishment.notes || "—")}</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">
        Disbursements — ${activeDisbursements.length} active voucher${activeDisbursements.length !== 1 ? "s" : ""}
      </div>
      <table>
        <thead>
          <tr>
            <th style="width:32px;text-align:center">#</th>
            <th>Voucher No.</th>
            <th>Date</th>
            <th>Description</th>
            <th>Category</th>
            <th>Property</th>
            <th class="right">Amount (KES)</th>
          </tr>
        </thead>
        <tbody>
          ${disbRows || `<tr><td colspan="7" style="text-align:center;padding:18px;color:#94a3b8;font-style:italic">No disbursements recorded</td></tr>`}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="6" style="text-align:right;color:#64748b">Total Disbursed</td>
            <td class="right">${totalSpent.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div class="section">
      <div class="section-title">Financial Summary</div>
      <div class="summary-grid">
        <div class="sum-box">
          <div class="sum-label">Float Target</div>
          <div class="sum-val">${fmt(floatAmt)}</div>
        </div>
        <div class="sum-box">
          <div class="sum-label">Balance Before Replenishment</div>
          <div class="sum-val">${fmt(balanceBefore)}</div>
        </div>
        <div class="sum-box">
          <div class="sum-label">Total Disbursed (Active Vouchers)</div>
          <div class="sum-val" style="color:#dc2626">${fmt(totalSpent)}</div>
        </div>
        <div class="sum-box highlight">
          <div class="sum-label">Amount Requested (Top-Up)</div>
          <div class="sum-val">${fmt(repAmount)}</div>
          <div class="sum-words">${escapeHtml(inWords(repAmount))}</div>
        </div>
      </div>
    </div>

    <div class="sig-section">
      <div class="sig-section-title">Authorizations</div>
      <div class="sig-table four">
        <div class="sig-block">
          <div class="sig-title">Requested By</div>
          <div class="sig-line" style="display:flex;align-items:flex-end;padding-bottom:3px;"><span style="font-size:11px;font-weight:700;color:#0f172a;">${escapeHtml(requestedByName)}</span></div>
          <div class="sig-sub">Signature &amp; Date</div>
        </div>
        <div class="sig-block">
          <div class="sig-title">Verified By</div>
          <div class="sig-line"></div>
          <div class="sig-sub">Signature</div>
          <div class="sig-line"></div>
          <div class="sig-sub">Name &amp; Date</div>
        </div>
        <div class="sig-block">
          <div class="sig-title">Approved By</div>
          <div class="sig-line"></div>
          <div class="sig-sub">Signature</div>
          <div class="sig-line"></div>
          <div class="sig-sub">Name &amp; Date</div>
        </div>
        <div class="sig-block">
          <div class="sig-title">Finance Officer</div>
          <div class="sig-line"></div>
          <div class="sig-sub">Signature</div>
          <div class="sig-line"></div>
          <div class="sig-sub">Name &amp; Date</div>
        </div>
      </div>
    </div>

    <div class="notice">
      This is an official imprest reimbursement form generated by ${escapeHtml(c.name)}. Retain for audit purposes.<br />
      Printed on ${new Date().toLocaleDateString("en-KE", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
    </div>
  </div>
</body>
</html>`;

  return openPrint(html, `REP — ${replenishment.replenishmentNumber}`);
};
