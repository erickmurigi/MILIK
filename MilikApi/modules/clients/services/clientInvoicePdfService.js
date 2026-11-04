// Client invoice PDF — built on the same shared print kit every other printed document
// in the system uses (letterhead, totals block, watermark, amount-in-words), instead of
// the module's own bespoke HTML/CSS. Mirrors services/invoicePdfService.js (PMS tenant
// invoices) as closely as the data shapes allow. Shows per-line tax codes, the service
// period, note adjustments, payment instructions (bank + M-Pesa paybill with the client
// code as account reference) and the eTIMS control-unit details once submitted.
import ClientInvoice from "../models/ClientInvoice.js";
import Company from "../../../models/Company.js";
import CompanySettings from "../../../models/CompanySettings.js";
import { documentPageHtml, formatMoney } from "../../../utils/printKitCore.js";
import { COMPANY_PRINT_FIELDS } from "../../../utils/printCompanyFields.js";
import { renderHtmlToPdf } from "../../../utils/pdfRender.js";
import { computeClientInvoiceOutstanding } from "./clientInvoiceBalanceService.js";

const pdfBufferCache = new Map();
const pdfRenderPromises = new Map();
const MAX_PDF_CACHE_ENTRIES = 24;

export const formatDate = (value) => (value ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "");

const STATUS_LABEL = { draft: "Draft", posted: "Posted", sent: "Sent", partial: "Partially paid", partially_paid: "Partially paid", paid: "Paid", overdue: "Overdue", cancelled: "Cancelled", credited: "Credited" };
const STATUS_TONE = { draft: "neutral", posted: "info", sent: "info", partial: "warning", partially_paid: "warning", paid: "success", overdue: "danger", cancelled: "neutral", credited: "neutral" };

const rememberPdfBuffer = (cacheKey, buffer) => {
  if (!cacheKey || !buffer) return;
  pdfBufferCache.set(cacheKey, Buffer.from(buffer));
  while (pdfBufferCache.size > MAX_PDF_CACHE_ENTRIES) {
    pdfBufferCache.delete(pdfBufferCache.keys().next().value);
  }
};

const getCachedPdfBuffer = (cacheKey) => {
  if (!cacheKey || !pdfBufferCache.has(cacheKey)) return null;
  const cached = pdfBufferCache.get(cacheKey);
  pdfBufferCache.delete(cacheKey);
  pdfBufferCache.set(cacheKey, cached);
  return Buffer.from(cached);
};

// The letterhead prints the company's own name/logo/address/PIN and the "Bill to" block
// prints the client's, so both of their update times are part of the key — editing
// either must not leave a cached PDF with stale details.
const buildPdfCacheKey = (invoice, clientUpdatedAt = null, companyUpdatedAt = null, settingsUpdatedAt = null) => {
  const stamp = (v) => (v ? new Date(v).toISOString() : "");
  return `client-invoice::${String(invoice?._id || "")}::${stamp(invoice?.updatedAt)}::${stamp(clientUpdatedAt)}::${stamp(companyUpdatedAt)}::${stamp(settingsUpdatedAt)}`;
};

// Bank + M-Pesa instructions shared by invoices, quotes and notes. The client code is the paybill
// account reference so receipts can be matched to the client automatically.
export const buildPaymentInstructions = ({ company = {}, billing = {}, client = {} }) => {
  const items = [];
  const bank = billing.bankDetails || {};
  if (bank.bankName || bank.accountNumber) {
    items.push(
      [bank.bankName, bank.branch ? `${bank.branch} branch` : ""].filter(Boolean).join(", "),
      bank.accountName ? `Account name: ${bank.accountName}` : "",
      bank.accountNumber ? `Account no: ${bank.accountNumber}` : "",
      bank.swiftCode ? `SWIFT: ${bank.swiftCode}` : ""
    );
  }
  const paybills = company.paymentIntegration?.mpesaPaybills || [];
  const activePaybill = paybills.find((p) => p.enabled && p.shortCode) || company.paymentIntegration?.mpesaPaybill;
  const paybill = billing.mpesaPaybill || activePaybill?.shortCode || "";
  if (paybill) {
    items.push(`M-Pesa: Paybill ${paybill}, Account ${client.clientCode || client.name || ""}`);
  }
  return items.filter(Boolean);
};

const COMPANY_FIELDS = `${COMPANY_PRINT_FIELDS} slogan invoicePaymentTerms paymentIntegration.mpesaPaybills.shortCode paymentIntegration.mpesaPaybills.enabled paymentIntegration.mpesaPaybill.shortCode`;

export const generateClientInvoicePdf = async (invoiceId, businessId) => {
  // Cheap, indexed lookups (just enough to build the cache key and enforce access) so a
  // cache hit never pays for the full populated fetch below — that one only runs on an
  // actual miss.
  const [invoiceStub, companyStub, settingsStub] = await Promise.all([
    ClientInvoice.findOne({ _id: invoiceId, business: businessId })
      .select("_id updatedAt client")
      .populate("client", "updatedAt")
      .lean(),
    Company.findById(businessId).select("updatedAt").lean(),
    CompanySettings.findOne({ company: businessId }).select("updatedAt").lean(),
  ]);

  if (!invoiceStub) { const e = new Error("Invoice not found or access denied"); e.status = 404; throw e; }

  const cacheKey = buildPdfCacheKey(invoiceStub, invoiceStub.client?.updatedAt, companyStub?.updatedAt, settingsStub?.updatedAt);
  const cachedPdfBuffer = getCachedPdfBuffer(cacheKey);
  if (cachedPdfBuffer) return cachedPdfBuffer;

  if (pdfRenderPromises.has(cacheKey)) {
    return Buffer.from(await pdfRenderPromises.get(cacheKey));
  }

  const renderPromise = (async () => {
    const [invoice, settings] = await Promise.all([
      ClientInvoice.findOne({ _id: invoiceId, business: businessId })
        .populate("client", "name clientCode email phone address billingAddress taxPin")
        .populate("contract", "contractNumber description")
        .populate("business", COMPANY_FIELDS)
        .lean(),
      CompanySettings.findOne({ company: businessId }).select("clientBilling").lean(),
    ]);

    if (!invoice) { const e = new Error("Invoice not found or access denied"); e.status = 404; throw e; }

    const company = invoice.business || {};
    const client = invoice.client || {};
    const contract = invoice.contract || {};
    const billing = settings?.clientBilling || {};
    const currency = invoice.currency || company.baseCurrency || "KES";
    const money = (v) => `${currency} ${formatMoney(v)}`;
    const lineMode = invoice.taxCalculation === "line";

    const total = Number(invoice.total || 0);
    const paidAmount = Number(invoice.paidAmount || 0);
    const credited = Number(invoice.creditedAmount || 0);
    const debited = Number(invoice.debitedAmount || 0);
    const balance = Math.max(0, computeClientInvoiceOutstanding(invoice));

    const statusLabel = STATUS_LABEL[invoice.status] || String(invoice.status || "Draft");
    const statusTone = STATUS_TONE[invoice.status] || "neutral";
    const watermark = invoice.status === "paid" ? "PAID" : invoice.status === "cancelled" ? "VOID" : invoice.status === "draft" ? "DRAFT" : "";

    const addr = client.billingAddress?.line1 ? client.billingAddress : client.address || {};
    const clientAddr = [addr.line1, addr.city, addr.country].filter(Boolean).join(", ");

    // VAT summary by rate, so mixed standard / zero-rated / exempt invoices read like a tax invoice.
    const vatByCode = new Map();
    if (lineMode) {
      for (const item of invoice.lineItems || []) {
        const key = item.taxCodeName || item.taxCodeKey || "No Tax";
        const cur = vatByCode.get(key) || { rate: item.taxRate || 0, net: 0, tax: 0 };
        cur.net += Number(item.amount || 0);
        cur.tax += Number(item.taxAmount || 0);
        vatByCode.set(key, cur);
      }
    }

    const paymentLines = buildPaymentInstructions({ company, billing, client });
    const etimsLines = invoice.etimsCuInvoiceNumber
      ? [`CU invoice no: ${invoice.etimsCuInvoiceNumber}`, invoice.etimsQrUrl ? `Verify: ${invoice.etimsQrUrl}` : ""]
      : invoice.status !== "draft" ? [`eTIMS status: ${String(invoice.etimsStatus || "not_submitted").replace(/_/g, " ")}`] : [];

    const html = documentPageHtml({
      company,
      docType: "Tax Invoice",
      docNumber: invoice.invoiceNumber || "",
      status: { label: statusLabel, tone: statusTone },
      watermark,
      meta: [
        ["Issue date", formatDate(invoice.issueDate) || "—"],
        ["Due date", formatDate(invoice.dueDate) || "—"],
        ...(invoice.poNumber ? [["PO number", invoice.poNumber]] : []),
      ],
      parties: [
        {
          heading: "Billed to",
          name: client.name || "",
          lines: [
            client.clientCode ? `Client code: ${client.clientCode}` : "",
            clientAddr,
            client.taxPin ? `KRA PIN: ${client.taxPin}` : "",
            client.phone || "",
            client.email || "",
          ],
        },
        ...(invoice.periodStart || contract.contractNumber
          ? [{
              heading: "Invoice details",
              name: "",
              lines: [
                invoice.periodStart ? `Service period: ${formatDate(invoice.periodStart)} – ${formatDate(invoice.periodEnd)}` : "",
                contract.contractNumber ? `Contract: ${contract.contractNumber}${invoice.contractVersion ? ` (v${invoice.contractVersion})` : ""}` : "",
              ],
            }]
          : []),
      ],
      table: {
        columns: [
          { label: "#", width: "28px", value: (r) => r.n },
          { label: "Description", value: (r) => r.description, sub: (r) => r.sub },
          { label: "Qty", align: "right", width: "44px", value: (r) => r.quantity },
          { label: `Unit Price`, align: "right", value: (r) => formatMoney(r.unitPrice) },
          ...(lineMode ? [
            { label: "Disc", align: "right", width: "44px", value: (r) => (r.discountPercent ? `${r.discountPercent}%` : "—") },
            { label: "Tax", align: "right", width: "70px", value: (r) => r.taxLabel },
          ] : []),
          { label: `Net (${currency})`, align: "right", value: (r) => formatMoney(r.amount) },
        ],
        rows: (Array.isArray(invoice.lineItems) ? invoice.lineItems : []).map((item, i) => ({
          n: i + 1,
          description: item.description || "—",
          sub: item.servicePeriodStart && item.description && !String(item.description).includes(" to ")
            ? `${formatDate(item.servicePeriodStart)} – ${formatDate(item.servicePeriodEnd)}`
            : "",
          quantity: item.quantity || 1,
          unitPrice: item.unitPrice || 0,
          discountPercent: item.discountPercent || 0,
          taxLabel: item.taxType === "vat" ? `${item.taxRate}%` : item.taxType === "zero_rated" ? "Zero" : item.taxType === "exempt" ? "Exempt" : "—",
          amount: lineMode ? item.amount : (item.quantity || 1) * (item.unitPrice || 0),
        })),
      },
      totals: [
        { label: "Subtotal", value: money(invoice.subtotal) },
        ...(Number(invoice.discountTotal || 0) > 0 ? [{ label: "Discounts", value: money(-invoice.discountTotal) }] : []),
        ...(lineMode
          ? [...vatByCode.entries()].filter(([, v]) => v.tax > 0).map(([name, v]) => ({ label: `${name} (${v.rate}%)`, value: money(v.tax) }))
          : [{ label: `VAT (${invoice.vatRate ?? 16}%)`, value: money(invoice.vatAmount) }]),
        { label: "Total", value: money(total), hero: true },
        ...(credited > 0 ? [{ label: "Credit notes", value: money(-credited), tone: "pos" }] : []),
        ...(debited > 0 ? [{ label: "Debit notes", value: money(debited) }] : []),
        ...(paidAmount > 0 ? [{ label: "Amount paid", value: money(paidAmount), tone: "pos" }] : []),
        ...(paidAmount > 0 || credited > 0 || debited > 0
          ? [{ label: balance > 0 ? "Balance due" : "Nothing due", value: money(balance), strong: true, tone: balance > 0 ? "neg" : "pos" }]
          : []),
      ],
      amountWords: { amount: total, currency },
      notes: [
        ...(paymentLines.length ? [{ heading: "How to pay", items: paymentLines }] : []),
        ...(etimsLines.length ? [{ heading: "KRA eTIMS", items: etimsLines.filter(Boolean) }] : []),
        ...(invoice.notes ? [{ heading: "Notes", text: invoice.notes }] : []),
        ...(invoice.terms || billing.invoiceTerms ? [{ heading: "Terms", text: invoice.terms || billing.invoiceTerms }] : []),
      ],
      footerNote: "Thank you for your business.",
    });

    const pdfBuffer = await renderHtmlToPdf(html, "Invoice PDF");
    rememberPdfBuffer(cacheKey, pdfBuffer);
    return pdfBuffer;
  })();

  pdfRenderPromises.set(cacheKey, renderPromise);
  try {
    return Buffer.from(await renderPromise);
  } finally {
    pdfRenderPromises.delete(cacheKey);
  }
};
