import TenantInvoice from '../models/TenantInvoice.js';
import Landlord from '../models/Landlord.js';
import Company from '../models/Company.js';
import { documentPageHtml, formatMoney } from '../utils/printKitCore.js';
import { COMPANY_PRINT_FIELDS } from '../utils/printCompanyFields.js';
import { renderHtmlToPdf } from '../utils/pdfRender.js';

const pdfBufferCache = new Map();
const pdfRenderPromises = new Map();
const MAX_PDF_CACHE_ENTRIES = 24;

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));

const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

const esc = (value = '') =>
  String(value || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

const categoryLabel = (category = '') => {
  const map = {
    RENT_CHARGE: 'Rent Charge',
    UTILITY_CHARGE: 'Utility Charge',
    DEPOSIT_CHARGE: 'Deposit',
    LATE_PENALTY_CHARGE: 'Late Penalty',
    OTHER_CHARGE: 'Other Charge',
  };
  return map[category] || category.replace(/_/g, ' ');
};

const STATUS_LABEL = { paid: 'Paid', partially_paid: 'Partially paid', pending: 'Pending', cancelled: 'Cancelled', reversed: 'Reversed' };
const STATUS_TONE = { paid: 'success', partially_paid: 'warning', pending: 'info', cancelled: 'neutral', reversed: 'danger' };

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


// The letterhead prints the company's own name/logo/address/PIN (supplier = company —
// see below) and the "Landlord: X" line reads from the landlord, so both of their
// update times are part of the key: editing either must not leave a cached PDF with
// stale details.
const buildInvoicePdfCacheKey = (invoice, landlordUpdatedAt = null, companyUpdatedAt = null) => {
  const updatedAt = invoice?.updatedAt ? new Date(invoice.updatedAt).toISOString() : '';
  const landlordStamp = landlordUpdatedAt ? new Date(landlordUpdatedAt).toISOString() : '';
  const companyStamp = companyUpdatedAt ? new Date(companyUpdatedAt).toISOString() : '';
  return `invoice::${String(invoice?._id || '')}::${updatedAt}::${landlordStamp}::${companyStamp}`;
};

export const generateInvoicePdf = async (invoiceId, businessId) => {
  // Cheap, indexed lookup (just enough to build the cache key and enforce access) so a cache
  // hit never pays for the full populated fetch below — that one only runs on an actual miss.
  const invoiceStub = await TenantInvoice.findOne({ _id: invoiceId, business: businessId })
    .select('_id updatedAt landlord')
    .lean();

  if (!invoiceStub) { const e = new Error('Invoice not found or access denied'); e.status = 404; throw e; }

  const [landlordStub, companyStub] = await Promise.all([
    invoiceStub.landlord ? Landlord.findById(invoiceStub.landlord).select('updatedAt').lean() : null,
    Company.findById(businessId).select('updatedAt').lean(),
  ]);
  const cacheKey = buildInvoicePdfCacheKey(invoiceStub, landlordStub?.updatedAt, companyStub?.updatedAt);
  const cachedPdfBuffer = getCachedPdfBuffer(cacheKey);
  if (cachedPdfBuffer) return cachedPdfBuffer;

  if (pdfRenderPromises.has(cacheKey)) {
    return Buffer.from(await pdfRenderPromises.get(cacheKey));
  }

  const renderPromise = (async () => {
    const invoice = await TenantInvoice.findOne({ _id: invoiceId, business: businessId })
      .populate('tenant', 'name email tenantCode phone')
      .populate('property', 'propertyName propertyCode address invoicePaymentTerms mpesaPaybill')
      .populate('unit', 'unitNumber name')
      .populate('business', `${COMPANY_PRINT_FIELDS} slogan invoicePaymentTerms`)
      .populate('landlord', 'landlordName taxPin postalAddress location phoneNumber email')
      .lean();

    if (!invoice) { const e = new Error('Invoice not found or access denied'); e.status = 404; throw e; }

    const company = invoice.business || {};
    // The landlord is the supplier on every rent and utility invoice, so the letterhead carries
    // the landlord's name, address and KRA PIN. The company (the managing agent) is only the
    // fallback when no landlord is linked to the invoice.
    const supplier = company;
    const tenant = invoice.tenant || {};
    const property = invoice.property || {};
    const unit = invoice.unit || {};
    const unitNumber = unit.unitNumber || unit.name || '';

    const tax = invoice.taxSnapshot || {};
    const isTaxable = Boolean(tax.isTaxable);
    const taxRate = Number(tax.taxRate || 0);
    const netAmount = Number(tax.netAmount || 0);
    const taxAmount = Number(tax.taxAmount || 0);
    const grossAmount = Number(tax.grossAmount || invoice.amount || 0);
    const displayAmount = isTaxable ? grossAmount : Number(invoice.amount || 0);
    const currency = company.baseCurrency || 'KES';

    const paymentTerms =
      property.invoicePaymentTerms ||
      company.invoicePaymentTerms ||
      'Please pay your invoice before the due date to avoid late penalties.';

    const now = new Date();
    const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : null;
    const isOverdue = dueDate && dueDate < now && !['paid', 'cancelled', 'reversed'].includes(invoice.status);

    const statusLabel = isOverdue ? 'Overdue' : (STATUS_LABEL[invoice.status] || String(invoice.status || 'Issued'));
    const statusTone = isOverdue ? 'danger' : (STATUS_TONE[invoice.status] || 'neutral');
    const watermark = invoice.status === 'paid' ? 'PAID' : ['cancelled', 'reversed'].includes(invoice.status) ? 'VOID' : '';
    const money = (v) => `${currency} ${formatMoney(v)}`;

    const html = documentPageHtml({
      company: supplier,
      docType: 'Invoice',
      docNumber: invoice.invoiceNumber || '',
      status: { label: statusLabel, tone: statusTone },
      watermark,
      meta: [
        ['Invoice date', formatDate(invoice.invoiceDate) || '—'],
        ['Due date', formatDate(invoice.dueDate) || '—'],
      ],
      parties: [
        {
          heading: 'Billed to',
          name: tenant.name || '',
          lines: [
            tenant.tenantCode ? `Tenant code: ${tenant.tenantCode}` : '',
            tenant.phone || '',
            tenant.email || '',
          ],
        },
        {
          heading: 'Property',
          name: property.propertyName ? `${property.propertyName}${property.propertyCode ? ` (${property.propertyCode})` : ''}` : '',
          lines: [invoice.landlord?.landlordName ? `Landlord: ${invoice.landlord.landlordName}` : '', unitNumber ? `Unit: ${unitNumber}` : ''],
        },
      ],
      details: { heading: 'Invoice details', rows: [['Category', categoryLabel(invoice.category)], ['Currency', currency]] },
      table: {
        columns: [
          { label: 'Description', value: (r) => r.label, sub: (r) => r.sub },
          { label: `Amount (${currency})`, align: 'right', value: (r) => r.amount },
        ],
        rows: [
          { label: categoryLabel(invoice.category), sub: invoice.description || '', amount: formatMoney(isTaxable ? netAmount : displayAmount) },
          ...(isTaxable && taxAmount > 0 ? [{ label: `VAT / Tax (${taxRate}%)`, sub: '', amount: formatMoney(taxAmount) }] : []),
        ],
      },
      totals: [
        ...(isTaxable ? [{ label: 'Subtotal', value: money(netAmount) }, { label: `VAT / Tax (${taxRate}%)`, value: money(taxAmount) }] : []),
        { label: invoice.status === 'paid' ? 'Total (paid)' : 'Total due', value: money(displayAmount), hero: true },
      ],
      amountWords: { amount: displayAmount, currency },
      notes: [{ heading: 'Payment terms', text: paymentTerms }],
      footerNote: 'Thank you for your business.',
    });

    const pdfBuffer = await renderHtmlToPdf(html, 'Invoice PDF');
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
