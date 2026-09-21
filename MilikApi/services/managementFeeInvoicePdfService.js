import { htmlToPdf } from "./pdfService.js";
import { documentPageHtml } from "../utils/printKitCore.js";

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
    ? `[${property.propertyCode}] ${property.propertyName || property.name || ""}`
    : property.propertyName || property.name || "—";

  const basisLabel = commissionBasisLabel(statement.commissionBasis);
  const feeDescription =
    property.commissionPaymentMode === "fixed"
      ? "Management Fee (Fixed Amount)"
      : `Management Fee (${Number(statement.commissionPercentage || 0)}% — ${basisLabel})`;

  const currency = co.baseCurrency || "KES";
  const money = (v) => `${currency} ${fmtMoney(v)}`;
  const html = documentPageHtml({
    company: co,
    docType: "Tax Invoice",
    docNumber: invoiceNo,
    status: { label: "Deducted from disbursement", tone: "info" },
    meta: [["Invoice date", invoiceDate], ["Billing period", periodRange]],
    parties: [
      { heading: "Billed to", name: landlordName, lines: [landlord.email || "", landlord.contact ? String(landlord.contact) : ""] },
      { heading: "Property", name: propLabel, lines: [] },
    ],
    details: { heading: "Reference", rows: [["Statement ref", statement.sourceStatementNumber || "—"], ["Fee basis", basisLabel]] },
    table: {
      columns: [
        { label: "Description", value: (r) => r.label },
        { label: `Amount (${currency})`, align: "right", value: (r) => r.amount },
      ],
      rows: [{ label: feeDescription, amount: fmtMoney(commissionNet) }],
    },
    totals: [
      ...(commissionTax > 0
        ? [{ label: "Subtotal", value: money(commissionNet) }, { label: displayTaxRate ? `VAT (${displayTaxRate}%)` : "VAT", value: money(commissionTax) }]
        : []),
      { label: "Total due", value: money(commissionGross), hero: true },
    ],
    amountWords: { amount: commissionGross, currency },
    notes: [{ heading: "Note", text: "This management fee has been deducted from the landlord disbursement for the period shown above. No separate payment is required." }],
    footerNote: "Management fee tax invoice",
  });

  return htmlToPdf(html, { format: "A4" });
};
