import { htmlToPdf } from "./pdfService.js";

const esc = (str) => String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmtMoney = (v) => Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (v) =>
  v ? new Date(v).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" }) : "—";

const commissionBasisLabel = (basis) =>
  basis === "invoiced"
    ? "Accrual (Rent Invoiced)"
    : basis === "received_manager_only"
    ? "Cash (Manager Collections Only)"
    : "Cash (Rent Collected)";

export const generateManagementFeeInvoicePdf = async (statement) => {
  const co = statement.business || {};
  const landlord = statement.landlord || {};
  const property = statement.property || {};

  const commissionNet = Number(statement.commissionAmount || 0);
  const commissionTax = Number(statement.commissionTaxAmount || 0);
  const commissionGross = Number(statement.commissionGrossAmount || commissionNet + commissionTax);
  const taxRate = Number(statement.commissionTaxRate || 0);

  const invoiceNo = statement.managementFeeInvoiceNumber || `MF-${String(statement._id).slice(-8).toUpperCase()}`;
  const displayTaxRate =
    taxRate > 0
      ? taxRate
      : commissionNet > 0
      ? Math.round((commissionTax / commissionNet) * 100)
      : null;
  const invoiceDate = fmtDate(statement.closedAt || statement.createdAt);
  const periodRange = `${fmtDate(statement.periodStart)} — ${fmtDate(statement.periodEnd)}`;

  const landlordName =
    landlord.landlordName ||
    `${landlord.firstName || ""} ${landlord.lastName || ""}`.trim() ||
    "—";

  const propLabel = property.propertyCode
    ? `[${esc(property.propertyCode)}] ${esc(property.propertyName || property.name || "")}`
    : esc(property.propertyName || property.name || "—");

  const basisLabel = commissionBasisLabel(statement.commissionBasis);
  const feeDescription =
    property.commissionPaymentMode === "fixed"
      ? "Management Fee (Fixed Amount)"
      : `Management Fee (${Number(statement.commissionPercentage || 0)}% — ${basisLabel})`;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 10pt; color: #1a1a1a; background: white; padding: 44px 48px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; padding-bottom: 18px; border-bottom: 3px solid #0B3B2E; }
  .co-name { font-size: 15pt; font-weight: bold; color: #0B3B2E; margin-bottom: 5px; }
  .co-meta { font-size: 8.5pt; color: #555; line-height: 1.6; }
  .invoice-title { text-align: right; }
  .invoice-title h1 { font-size: 18pt; font-weight: bold; color: #0B3B2E; letter-spacing: 1.5px; }
  .invoice-title .inv-no { font-size: 11pt; font-weight: bold; color: #222; margin-top: 7px; }
  .invoice-title .inv-date { font-size: 9pt; color: #666; margin-top: 3px; }
  .parties { display: flex; gap: 40px; margin-bottom: 22px; }
  .party { flex: 1; }
  .party-label { font-size: 7.5pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.8px; color: #0B3B2E; border-bottom: 1px solid #0B3B2E; padding-bottom: 3px; margin-bottom: 7px; }
  .party-name { font-size: 11pt; font-weight: bold; color: #1a1a1a; margin-bottom: 3px; }
  .party-meta { font-size: 8.5pt; color: #555; line-height: 1.6; }
  .ref-row { background: #f2f7f4; border: 1px solid #c9ddd2; border-radius: 4px; padding: 10px 16px; margin-bottom: 22px; display: flex; gap: 40px; }
  .ref-label { font-size: 7.5pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.6px; color: #0B3B2E; margin-bottom: 3px; }
  .ref-value { font-size: 9.5pt; font-weight: bold; color: #1a1a1a; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  thead tr { background: #0B3B2E; color: white; }
  thead th { padding: 9px 14px; text-align: left; font-size: 9pt; font-weight: bold; letter-spacing: 0.4px; }
  thead th.num { text-align: right; }
  tbody tr { border-bottom: 1px solid #e5e5e5; }
  tbody tr:last-child { border-bottom: none; }
  tbody td { padding: 11px 14px; font-size: 10pt; }
  tbody td.num { text-align: right; font-family: "Courier New", monospace; }
  tfoot tr.subtotal td { padding: 8px 14px; border-top: 1px solid #ccc; font-size: 9.5pt; color: #444; }
  tfoot tr.subtotal td.num { text-align: right; font-family: "Courier New", monospace; }
  tfoot tr.total td { padding: 11px 14px; border-top: 2px solid #0B3B2E; font-weight: bold; font-size: 12pt; }
  tfoot tr.total td.num { text-align: right; font-family: "Courier New", monospace; color: #0B3B2E; }
  .note { background: #fffbeb; border: 1px solid #f5e07e; border-radius: 4px; padding: 10px 14px; font-size: 8.5pt; color: #6b5500; margin-bottom: 14px; line-height: 1.5; }
  .footer { margin-top: 36px; padding-top: 12px; border-top: 1px solid #ddd; font-size: 7.5pt; color: #aaa; text-align: center; letter-spacing: 0.3px; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="co-name">${esc(co.companyName || co.name || "PROPERTY MANAGEMENT")}</div>
      <div class="co-meta">
        ${co.address ? `${esc(co.address)}<br>` : ""}
        ${co.phone ? `Tel: ${esc(co.phone)}` : ""}${co.phone && co.email ? "&nbsp;&nbsp;|&nbsp;&nbsp;" : ""}${co.email ? `Email: ${esc(co.email)}` : ""}
      </div>
    </div>
    <div class="invoice-title">
      <h1>TAX INVOICE</h1>
      <div class="inv-no">Invoice No: ${esc(invoiceNo)}</div>
      <div class="inv-date">Date: ${invoiceDate}</div>
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <div class="party-label">Billed To</div>
      <div class="party-name">${esc(landlordName)}</div>
      <div class="party-meta">
        ${landlord.email ? `${esc(landlord.email)}<br>` : ""}
        ${landlord.contact ? esc(String(landlord.contact)) : ""}
      </div>
    </div>
    <div class="party">
      <div class="party-label">Property</div>
      <div class="party-name">${propLabel}</div>
    </div>
  </div>

  <div class="ref-row">
    <div>
      <div class="ref-label">Billing Period</div>
      <div class="ref-value">${periodRange}</div>
    </div>
    <div>
      <div class="ref-label">Statement Ref</div>
      <div class="ref-value">${esc(statement.sourceStatementNumber || "—")}</div>
    </div>
    <div>
      <div class="ref-label">Fee Basis</div>
      <div class="ref-value">${esc(basisLabel)}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>DESCRIPTION</th>
        <th class="num">AMOUNT (KES)</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${esc(feeDescription)}</td>
        <td class="num">${fmtMoney(commissionNet)}</td>
      </tr>
    </tbody>
    <tfoot>
      ${commissionTax > 0 ? `
      <tr class="subtotal">
        <td>Subtotal</td>
        <td class="num">${fmtMoney(commissionNet)}</td>
      </tr>
      <tr class="subtotal">
        <td>${displayTaxRate ? `VAT (${displayTaxRate}%)` : "VAT"}</td>
        <td class="num">${fmtMoney(commissionTax)}</td>
      </tr>` : ""}
      <tr class="total">
        <td>TOTAL DUE</td>
        <td class="num">KES&nbsp;${fmtMoney(commissionGross)}</td>
      </tr>
    </tfoot>
  </table>

  <div class="note">
    This management fee has been deducted from the landlord disbursement for the period shown above.
    No separate payment is required.
  </div>

  <div class="footer">
    ${esc(co.companyName || "Property Management")}&nbsp;&nbsp;|&nbsp;&nbsp;Management Fee Tax Invoice&nbsp;&nbsp;|&nbsp;&nbsp;${esc(invoiceNo)}
  </div>
</body>
</html>`;

  return htmlToPdf(html, { format: "A4" });
};
