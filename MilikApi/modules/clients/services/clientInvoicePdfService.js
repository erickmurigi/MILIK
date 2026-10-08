// Client invoice PDF — built on the same shared print kit every other printed document
// in the system uses (letterhead, totals block, watermark, amount-in-words), instead of
// the module's own bespoke HTML/CSS. Mirrors services/invoicePdfService.js (PMS tenant
// invoices) as closely as the data shapes allow.
import ClientInvoice from "../models/ClientInvoice.js";
import Company from "../../../models/Company.js";
import { documentPageHtml, formatMoney } from "../../../utils/printKitCore.js";
import { COMPANY_PRINT_FIELDS } from "../../../utils/printCompanyFields.js";
import { renderHtmlToPdf } from "../../../utils/pdfRender.js";

const pdfBufferCache = new Map();
const pdfRenderPromises = new Map();
const MAX_PDF_CACHE_ENTRIES = 24;

const formatDate = (value) => (value ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "");

const STATUS_LABEL = { draft: "Draft", sent: "Sent", partial: "Partially paid", paid: "Paid", overdue: "Overdue", cancelled: "Cancelled" };
const STATUS_TONE = { draft: "neutral", sent: "info", partial: "warning", paid: "success", overdue: "danger", cancelled: "neutral" };

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
const buildPdfCacheKey = (invoice, clientUpdatedAt = null, companyUpdatedAt = null) => {
  const updatedAt = invoice?.updatedAt ? new Date(invoice.updatedAt).toISOString() : "";
  const clientStamp = clientUpdatedAt ? new Date(clientUpdatedAt).toISOString() : "";
  const companyStamp = companyUpdatedAt ? new Date(companyUpdatedAt).toISOString() : "";
  return `client-invoice::${String(invoice?._id || "")}::${updatedAt}::${clientStamp}::${companyStamp}`;
};

export const generateClientInvoicePdf = async (invoiceId, businessId) => {
  // Cheap, indexed lookups (just enough to build the cache key and enforce access) so a
  // cache hit never pays for the full populated fetch below — that one only runs on an
  // actual miss.
  const [invoiceStub, companyStub] = await Promise.all([
    ClientInvoice.findOne({ _id: invoiceId, business: businessId })
      .select("_id updatedAt client")
      .populate("client", "updatedAt")
      .lean(),
    Company.findById(businessId).select("updatedAt").lean(),
  ]);

  if (!invoiceStub) { const e = new Error("Invoice not found or access denied"); e.status = 404; throw e; }

  const cacheKey = buildPdfCacheKey(invoiceStub, invoiceStub.client?.updatedAt, companyStub?.updatedAt);
  const cachedPdfBuffer = getCachedPdfBuffer(cacheKey);
  if (cachedPdfBuffer) return cachedPdfBuffer;

  if (pdfRenderPromises.has(cacheKey)) {
    return Buffer.from(await pdfRenderPromises.get(cacheKey));
  }

  const renderPromise = (async () => {
    const invoice = await ClientInvoice.findOne({ _id: invoiceId, business: businessId })
      .populate("client", "name clientCode email phone address taxPin")
      .populate("contract", "contractNumber description")
      .populate("business", `${COMPANY_PRINT_FIELDS} slogan invoicePaymentTerms`)
      .lean();

    if (!invoice) { const e = new Error("Invoice not found or access denied"); e.status = 404; throw e; }

    const company = invoice.business || {};
    const client = invoice.client || {};
    const contract = invoice.contract || {};
    const currency = company.baseCurrency || "KES";
    const money = (v) => `${currency} ${formatMoney(v)}`;

    const total = Number(invoice.total || 0);
    const paidAmount = Number(invoice.paidAmount || 0);
    const balance = Math.max(0, total - paidAmount);

    const statusLabel = STATUS_LABEL[invoice.status] || String(invoice.status || "Draft");
    const statusTone = STATUS_TONE[invoice.status] || "neutral";
    const watermark = invoice.status === "paid" ? "PAID" : invoice.status === "cancelled" ? "VOID" : "";

    const clientAddr = [client.address?.line1, client.address?.city, client.address?.country].filter(Boolean).join(", ");

    const html = documentPageHtml({
      company,
      docType: "Invoice",
      docNumber: invoice.invoiceNumber || "",
      status: { label: statusLabel, tone: statusTone },
      watermark,
      meta: [
        ["Issue date", formatDate(invoice.issueDate) || "—"],
        ["Due date", formatDate(invoice.dueDate) || "—"],
      ],
      parties: [
        {
          heading: "Billed to",
          name: client.name || "",
          lines: [
            client.clientCode ? `Client code: ${client.clientCode}` : "",
            clientAddr,
            client.taxPin ? `PIN: ${client.taxPin}` : "",
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
                contract.contractNumber ? `Contract: ${contract.contractNumber}` : "",
              ],
            }]
          : []),
      ],
      table: {
        columns: [
          { label: "#", width: "28px", value: (_r, i) => i + 1 },
          { label: "Description", value: (r) => r.description, sub: (r) => r.notes || "" },
          { label: "Qty", align: "right", width: "48px", value: (r) => r.quantity },
          { label: `Unit Price (${currency})`, align: "right", value: (r) => formatMoney(r.unitPrice) },
          { label: `Amount (${currency})`, align: "right", value: (r) => formatMoney(r.amount) },
        ],
        rows: (Array.isArray(invoice.lineItems) ? invoice.lineItems : []).map((item) => ({
          description: item.description || "—",
          notes: item.notes || "",
          quantity: item.quantity || 1,
          unitPrice: item.unitPrice || 0,
          amount: (item.quantity || 1) * (item.unitPrice || 0),
        })),
      },
      totals: [
        { label: "Subtotal", value: money(invoice.subtotal) },
        { label: `VAT (${invoice.vatRate ?? 16}%)`, value: money(invoice.vatAmount) },
        { label: "Total", value: money(total), hero: true },
        ...(paidAmount > 0
          ? [
              { label: "Amount paid", value: money(paidAmount), tone: "pos" },
              { label: balance > 0 ? "Balance due" : "Fully paid", value: money(balance), strong: true, tone: balance > 0 ? "neg" : "pos" },
            ]
          : []),
      ],
      amountWords: { amount: total, currency },
      notes: [
        ...(invoice.paymentMethod || invoice.paymentReference || invoice.paidAt
          ? [{
              heading: "Payment record",
              text: [
                invoice.paymentMethod ? `Method: ${invoice.paymentMethod}` : "",
                invoice.paymentReference ? `Ref: ${invoice.paymentReference}` : "",
                invoice.paidAt ? `Date: ${formatDate(invoice.paidAt)}` : "",
              ].filter(Boolean).join(" · "),
            }]
          : []),
        ...(invoice.notes ? [{ heading: "Notes", text: invoice.notes }] : []),
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
