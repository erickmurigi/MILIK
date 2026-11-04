// PDFs for contracts, quotes/proformas and credit/debit notes, on the shared print kit (same
// letterhead and layout as the client invoice). Rendered on demand; these documents change rarely
// and are printed far less often than invoices, so there is no buffer cache here.
import ClientContract from "../models/ClientContract.js";
import ClientQuote from "../models/ClientQuote.js";
import ClientCreditNote from "../models/ClientCreditNote.js";
import CompanySettings from "../../../models/CompanySettings.js";
import { documentPageHtml, formatMoney } from "../../../utils/printKitCore.js";
import { COMPANY_PRINT_FIELDS } from "../../../utils/printCompanyFields.js";
import { renderHtmlToPdf } from "../../../utils/pdfRender.js";
import { buildPaymentInstructions, formatDate } from "./clientInvoicePdfService.js";
import { calculateLineAmounts, effectiveContractLines, summarizeLines } from "./clientLineMath.js";

const COMPANY_FIELDS = `${COMPANY_PRINT_FIELDS} slogan paymentIntegration.mpesaPaybills.shortCode paymentIntegration.mpesaPaybills.enabled paymentIntegration.mpesaPaybill.shortCode`;
const CLIENT_FIELDS = "name clientCode email phone address billingAddress taxPin";
const FREQ_LABEL = { one_off: "One-off", monthly: "Monthly", quarterly: "Quarterly", semi_annual: "Semi-annual", annual: "Annual" };

const notFound = (label) => { const e = new Error(`${label} not found or access denied`); e.status = 404; return e; };
const clientParty = (client = {}, heading = "Client") => {
  const addr = client.billingAddress?.line1 ? client.billingAddress : client.address || {};
  return {
    heading,
    name: client.name || "",
    lines: [
      client.clientCode ? `Client code: ${client.clientCode}` : "",
      [addr.line1, addr.city, addr.country].filter(Boolean).join(", "),
      client.taxPin ? `KRA PIN: ${client.taxPin}` : "",
      client.phone || "",
      client.email || "",
    ],
  };
};

const pricedLines = (lines, taxMode) => lines.map((line, i) => ({ ...line, n: i + 1, ...calculateLineAmounts({ ...line, taxMode }) }));

const lineTable = (lines, currency) => ({
  columns: [
    { label: "#", width: "28px", value: (r) => r.n },
    { label: "Service", value: (r) => r.itemName, sub: (r) => [r.description, r.billingFrequency ? FREQ_LABEL[r.billingFrequency] || r.billingFrequency : ""].filter(Boolean).join(" · ") },
    { label: "Qty", align: "right", width: "44px", value: (r) => r.quantity },
    { label: "Unit Price", align: "right", value: (r) => formatMoney(r.unitPrice) },
    { label: "Disc", align: "right", width: "44px", value: (r) => (r.discountPercent ? `${r.discountPercent}%` : "—") },
    { label: "Tax", align: "right", width: "60px", value: (r) => (r.taxType === "vat" ? `${r.taxRate}%` : r.taxType === "zero_rated" ? "Zero" : r.taxType === "exempt" ? "Exempt" : "—") },
    { label: `Net (${currency})`, align: "right", value: (r) => formatMoney(r.netAmount) },
  ],
  rows: lines,
});

export const generateContractPdf = async (contractId, businessId) => {
  const [contract, settings] = await Promise.all([
    ClientContract.findOne({ _id: contractId, business: businessId })
      .populate("client", CLIENT_FIELDS)
      .populate("business", COMPANY_FIELDS)
      .populate("owner", "surname otherNames")
      .lean(),
    CompanySettings.findOne({ company: businessId }).select("clientBilling").lean(),
  ]);
  if (!contract) throw notFound("Contract");
  const company = contract.business || {};
  const currency = contract.currency || company.baseCurrency || "KES";
  const money = (v) => `${currency} ${formatMoney(v)}`;
  const lines = pricedLines(effectiveContractLines(contract), contract.taxMode);
  const term = contract.openEnded ? "Open-ended" : `${formatDate(contract.startDate)} – ${formatDate(contract.endDate)}`;

  const html = documentPageHtml({
    company,
    docType: "Service Agreement",
    docNumber: `${contract.contractNumber || ""}${contract.version > 1 ? ` v${contract.version}` : ""}`,
    status: { label: String(contract.status || "draft").replace(/_/g, " "), tone: contract.status === "active" ? "success" : "neutral" },
    watermark: ["draft", "pending_approval"].includes(contract.status) ? "DRAFT" : contract.status === "cancelled" ? "VOID" : "",
    meta: [
      ["Start date", formatDate(contract.startDate)],
      ["Term", term],
      ...(contract.poNumber ? [["PO number", contract.poNumber]] : []),
    ],
    parties: [
      { heading: "Service provider", name: company.companyName || company.name || "", lines: [company.taxPIN ? `KRA PIN: ${company.taxPIN}` : "", company.email || "", company.phone || company.phoneNo || ""] },
      clientParty(contract.client, "Client"),
    ],
    details: {
      heading: "Commercial terms",
      rows: [
        ["Contract type", String(contract.contractType || "").replace(/_/g, " ")],
        ["Monthly recurring value", money(contract.mrr)],
        ["Annual contract value", money(contract.acv)],
        ["Total contract value", money(contract.tcv)],
        ["Payment terms", `${contract.paymentTermsDays ?? 30} days`],
        ["Billing day", contract.billingDay ? `Day ${contract.billingDay}` : "Contract anniversary"],
        ["Price escalation", contract.escalationPercent ? `${contract.escalationPercent}% every ${contract.escalationPeriodYears} year(s)` : "None"],
        ["Notice period", `${contract.noticePeriodDays ?? 30} days`],
        ["Minimum term", contract.minimumTermMonths ? `${contract.minimumTermMonths} months` : ""],
        ["Late payment interest", contract.latePaymentInterestPercent ? `${contract.latePaymentInterestPercent}% p.m.` : ""],
        ["Deposit", contract.depositAmount ? money(contract.depositAmount) : ""],
        ["Auto-renew", contract.autoRenew ? `Yes, ${contract.renewalTermMonths} months` : "No"],
      ],
    },
    table: lineTable(lines, currency),
    notes: [
      ...(contract.description ? [{ heading: "Scope", text: contract.description }] : []),
      ...(contract.slaText ? [{ heading: "Service levels", text: contract.slaText }] : []),
      ...(contract.terms ? [{ heading: "Terms and conditions", text: contract.terms }] : []),
      ...(buildPaymentInstructions({ company, billing: settings?.clientBilling || {}, client: contract.client || {} }).length
        ? [{ heading: "Payment", items: buildPaymentInstructions({ company, billing: settings?.clientBilling || {}, client: contract.client || {} }) }]
        : []),
    ],
    signatures: [
      { label: `For ${company.companyName || company.name || "the service provider"}`, name: contract.signedByUsAt ? `Signed ${formatDate(contract.signedByUsAt)}` : "" },
      { label: `For ${contract.client?.name || "the client"}`, name: contract.signedByClientAt ? `${contract.signedByClientName || "Signed"} ${formatDate(contract.signedByClientAt)}` : "" },
    ],
    stamp: true,
  });
  return renderHtmlToPdf(html, "Contract PDF");
};

export const generateQuotePdf = async (quoteId, businessId) => {
  const [quote, settings] = await Promise.all([
    ClientQuote.findOne({ _id: quoteId, business: businessId })
      .populate("client", CLIENT_FIELDS)
      .populate("business", COMPANY_FIELDS)
      .lean(),
    CompanySettings.findOne({ company: businessId }).select("clientBilling").lean(),
  ]);
  if (!quote) throw notFound("Quote");
  const company = quote.business || {};
  const currency = quote.currency || company.baseCurrency || "KES";
  const money = (v) => `${currency} ${formatMoney(v)}`;
  const lines = pricedLines(quote.lines || [], quote.taxMode);
  const totals = summarizeLines(lines);
  const isProforma = quote.kind === "proforma";

  const html = documentPageHtml({
    company,
    docType: isProforma ? "Proforma Invoice" : "Quotation",
    docNumber: quote.quoteNumber || "",
    status: { label: quote.status, tone: quote.status === "accepted" ? "success" : quote.status === "declined" || quote.status === "expired" ? "danger" : "info" },
    watermark: quote.status === "expired" ? "EXPIRED" : quote.status === "declined" ? "DECLINED" : "",
    meta: [["Date", formatDate(quote.issueDate)], ["Valid until", formatDate(quote.validUntil)]],
    parties: [clientParty(quote.client, "Prepared for")],
    table: lineTable(lines, currency),
    totals: [
      { label: "Subtotal", value: money(totals.subtotal) },
      ...(totals.discountTotal > 0 ? [{ label: "Discounts", value: money(-totals.discountTotal) }] : []),
      { label: "VAT", value: money(totals.taxAmount) },
      { label: "Total", value: money(totals.total), hero: true },
      ...(quote.recurringMonthly > 0 ? [{ label: "Recurring (monthly, net)", value: money(quote.recurringMonthly) }] : []),
    ],
    amountWords: { amount: totals.total, currency },
    notes: [
      ...(quote.title ? [{ heading: "Subject", text: quote.title }] : []),
      ...(quote.notes ? [{ heading: "Notes", text: quote.notes }] : []),
      ...(quote.terms ? [{ heading: "Terms", text: quote.terms }] : []),
      ...(isProforma && buildPaymentInstructions({ company, billing: settings?.clientBilling || {}, client: quote.client || {} }).length
        ? [{ heading: "How to pay", items: buildPaymentInstructions({ company, billing: settings?.clientBilling || {}, client: quote.client || {} }) }]
        : []),
    ],
    footerNote: isProforma ? "This is not a tax invoice." : `This quotation is valid until ${formatDate(quote.validUntil)}.`,
  });
  return renderHtmlToPdf(html, "Quote PDF");
};

export const generateClientNotePdf = async (noteId, businessId) => {
  const note = await ClientCreditNote.findOne({ _id: noteId, business: businessId })
    .populate("client", CLIENT_FIELDS)
    .populate("business", COMPANY_FIELDS)
    .lean();
  if (!note) throw notFound("Note");
  const company = note.business || {};
  const currency = note.currency || company.baseCurrency || "KES";
  const money = (v) => `${currency} ${formatMoney(v)}`;
  const isCredit = note.noteType === "CREDIT_NOTE";

  const html = documentPageHtml({
    company,
    docType: isCredit ? "Credit Note" : "Debit Note",
    docNumber: note.noteNumber,
    status: { label: note.status, tone: note.status === "reversed" ? "danger" : "success" },
    watermark: note.status === "reversed" ? "VOID" : "",
    meta: [["Date", formatDate(note.noteDate)], ["Against invoice", note.invoiceNumber || "—"]],
    parties: [clientParty(note.client, isCredit ? "Credited to" : "Billed to")],
    table: {
      columns: [
        { label: "#", width: "28px", value: (r) => r.n },
        { label: "Description", value: (r) => r.description },
        { label: "Tax", align: "right", width: "60px", value: (r) => (r.taxType === "vat" ? `${r.taxRate}%` : "—") },
        { label: `Net (${currency})`, align: "right", value: (r) => formatMoney(r.netAmount) },
        { label: `VAT (${currency})`, align: "right", value: (r) => formatMoney(r.taxAmount) },
        { label: `Total (${currency})`, align: "right", value: (r) => formatMoney(r.totalAmount) },
      ],
      rows: (note.lines || []).map((l, i) => ({ ...l, n: i + 1 })),
    },
    totals: [
      { label: "Subtotal", value: money(note.subtotal) },
      { label: "VAT", value: money(note.taxAmount) },
      { label: isCredit ? "Total credited" : "Total charged", value: money(note.total), hero: true },
    ],
    amountWords: { amount: note.total, currency },
    notes: [{ heading: "Reason", text: note.reason || "" }, ...(note.status === "reversed" ? [{ heading: "Reversed", text: note.reversalReason || "" }] : [])],
  });
  return renderHtmlToPdf(html, `${isCredit ? "Credit" : "Debit"} note PDF`);
};

export const sendPdf = (res, buffer, filename, preview = false) => {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${preview ? "inline" : "attachment"}; filename="${filename}"`);
  res.setHeader("Content-Length", buffer.length);
  res.send(buffer);
};
