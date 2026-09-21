import { createPage, resetBrowser } from './browserService.js';
import TenantInvoice from '../models/TenantInvoice.js';
import { documentPageHtml, formatMoney } from '../utils/printKitCore.js';
import { COMPANY_PRINT_FIELDS } from '../utils/printCompanyFields.js';

const pdfBufferCache = new Map();
const pdfRenderPromises = new Map();
const MAX_PDF_CACHE_ENTRIES = 24;
const MAX_CONCURRENT_PDF_RENDERS = 3;
const QUEUE_TIMEOUT_MS = 120_000;
const RENDER_TIMEOUT_MS = 90_000;
let activePdfRenderCount = 0;
const pdfRenderWaitQueue = [];

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

const withTimeout = (promise, ms, message) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);

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

const acquirePdfRenderSlot = async () => {
  if (activePdfRenderCount < MAX_CONCURRENT_PDF_RENDERS) {
    activePdfRenderCount += 1;
    return;
  }
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = pdfRenderWaitQueue.indexOf(resolve);
      if (idx !== -1) pdfRenderWaitQueue.splice(idx, 1);
      reject(new Error('PDF render queue timeout'));
    }, QUEUE_TIMEOUT_MS);
    pdfRenderWaitQueue.push(() => {
      clearTimeout(timer);
      resolve();
    });
  });
  activePdfRenderCount += 1;
};

const releasePdfRenderSlot = () => {
  activePdfRenderCount = Math.max(0, activePdfRenderCount - 1);
  const next = pdfRenderWaitQueue.shift();
  if (next) next();
};

const buildInvoicePdfCacheKey = (invoice) => {
  const updatedAt = invoice?.updatedAt ? new Date(invoice.updatedAt).toISOString() : '';
  return `invoice::${String(invoice?._id || '')}::${updatedAt}`;
};

export const generateInvoicePdf = async (invoiceId, businessId) => {
  const invoice = await TenantInvoice.findOne({ _id: invoiceId, business: businessId })
    .populate('tenant', 'name email tenantCode phone')
    .populate('property', 'propertyName propertyCode address invoicePaymentTerms mpesaPaybill')
    .populate('unit', 'unitNumber name')
    .populate('business', `${COMPANY_PRINT_FIELDS} slogan invoicePaymentTerms`)
    .lean();

  if (!invoice) { const e = new Error('Invoice not found or access denied'); e.status = 404; throw e; }

  const cacheKey = buildInvoicePdfCacheKey(invoice);
  const cachedPdfBuffer = getCachedPdfBuffer(cacheKey);
  if (cachedPdfBuffer) return cachedPdfBuffer;

  if (pdfRenderPromises.has(cacheKey)) {
    return Buffer.from(await pdfRenderPromises.get(cacheKey));
  }

  const renderPromise = (async () => {
    const company = invoice.business || {};
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
      company,
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
          lines: [unitNumber ? `Unit: ${unitNumber}` : ''],
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

    await acquirePdfRenderSlot();
    let page = null;
    try {
      page = await createPage();
      page.setDefaultNavigationTimeout(30_000);
      page.setDefaultTimeout(30_000);
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const pdfBuffer = await withTimeout(
        page.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' },
        }),
        RENDER_TIMEOUT_MS,
        'Invoice PDF render timed out'
      );
      try { await page.close(); } catch { /* ignore */ }
      rememberPdfBuffer(cacheKey, pdfBuffer);
      return Buffer.from(pdfBuffer);
    } catch (error) {
      await resetBrowser();
      throw error;
    } finally {
      releasePdfRenderSlot();
    }
  })();

  pdfRenderPromises.set(cacheKey, renderPromise);
  try {
    return Buffer.from(await renderPromise);
  } finally {
    pdfRenderPromises.delete(cacheKey);
  }
};
