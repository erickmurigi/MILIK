import { createPage, resetBrowser } from './browserService.js';
import RentPayment from '../models/RentPayment.js';
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

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';

const esc = (value = '') =>
  String(value || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

const humanizeSnake = (s = '') =>
  String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const withTimeout = (promise, ms, message) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);

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
    pdfRenderWaitQueue.push(() => { clearTimeout(timer); resolve(); });
  });
  activePdfRenderCount += 1;
};

const releasePdfRenderSlot = () => {
  activePdfRenderCount = Math.max(0, activePdfRenderCount - 1);
  const next = pdfRenderWaitQueue.shift();
  if (next) next();
};

export const generateReceiptPdf = async (receiptId, businessId) => {
  // Cheap, indexed lookup (just enough to build the cache key and enforce access) so a cache
  // hit never pays for the full populated fetch below — that one only runs on an actual miss.
  const receiptStub = await RentPayment.findOne({ _id: receiptId, business: businessId })
    .select('_id updatedAt')
    .lean();

  if (!receiptStub) { const e = new Error('Receipt not found or access denied'); e.status = 404; throw e; }

  const cacheKey = `receipt::${String(receiptStub._id)}::${receiptStub.updatedAt ? new Date(receiptStub.updatedAt).toISOString() : ''}`;
  const cached = getCachedPdfBuffer(cacheKey);
  if (cached) return cached;

  if (pdfRenderPromises.has(cacheKey)) {
    return Buffer.from(await pdfRenderPromises.get(cacheKey));
  }

  const renderPromise = (async () => {
    const receipt = await RentPayment.findOne({ _id: receiptId, business: businessId })
      .populate('tenant', 'name email tenantCode phone')
      .populate({ path: 'unit', select: 'unitNumber name property', populate: { path: 'property', select: 'propertyName propertyCode address' } })
      .populate('business', COMPANY_PRINT_FIELDS)
      .lean();

    if (!receipt) { const e = new Error('Receipt not found or access denied'); e.status = 404; throw e; }

    // Normalise field names so the rest of the service works unchanged
    receipt.property = receipt.unit?.property || {};
    receipt.receiptDate = receipt.paymentDate || receipt.createdAt;

    const company = receipt.business || {};
    const tenant = receipt.tenant || {};
    const property = receipt.property || {};
    const unit = receipt.unit || {};
    const unitNumber = unit.unitNumber || unit.name || '';
    const currency = company.baseCurrency || 'KES';
    const money = (v) => `${currency} ${formatMoney(v)}`;

    const amount = Number(receipt.amount || 0);
    const confirmed = Boolean(receipt.isConfirmed);

    // Build allocation rows from allocationSummary
    const alloc = receipt.allocationSummary || {};
    const allocRows = [
      { label: 'Rent', amount: Number(alloc.rent || 0) },
      { label: 'Utilities', amount: Number(alloc.utility || 0) },
      { label: 'Security Deposit', amount: Number(alloc.deposit || 0) },
      { label: 'Late Penalty', amount: Number(alloc.latePenalty || 0) },
      { label: 'Debit Note', amount: Number(alloc.debitNote || 0) },
      { label: 'Other Charges', amount: Number(alloc.other || 0) },
      { label: 'Unapplied / Advance', amount: Number(alloc.unapplied || 0) },
    ].filter((r) => r.amount > 0);
    const rows = allocRows.length > 0
      ? allocRows.map((r) => ({ label: r.label, sub: '', amount: formatMoney(r.amount) }))
      : [{ label: humanizeSnake(receipt.paymentType || 'Payment'), sub: receipt.description || '', amount: formatMoney(amount) }];

    const preparedBy = receipt.confirmedBy?.name || '';
    const companyName = company.companyName || company.name || 'the company';

    const html = documentPageHtml({
      company,
      docType: 'Receipt',
      docNumber: receipt.receiptNumber || receipt.referenceNumber || '',
      status: confirmed ? { label: 'Confirmed', tone: 'success' } : { label: 'Pending confirmation', tone: 'warning' },
      watermark: confirmed ? 'PAID' : '',
      meta: [
        ['Date', formatDate(receipt.receiptDate || receipt.paymentDate || receipt.createdAt)],
        ['Method', humanizeSnake(receipt.paymentMethod || 'Payment')],
        ...(receipt.referenceNumber ? [['Reference', receipt.referenceNumber]] : []),
      ],
      parties: [
        {
          heading: 'Received from',
          name: tenant.name || '',
          lines: [tenant.tenantCode ? `Tenant code: ${tenant.tenantCode}` : '', tenant.phone || ''],
        },
        {
          heading: 'Property',
          name: property.propertyName || '',
          lines: [unitNumber ? `Unit: ${unitNumber}` : ''],
        },
      ],
      details: { heading: 'Payment', rows: [['Cashbook', receipt.cashbook || ''], ['Status', confirmed ? 'Confirmed' : 'Pending confirmation']] },
      table: {
        columns: [
          { label: 'Applied to', value: (r) => r.label, sub: (r) => r.sub },
          { label: `Amount (${currency})`, align: 'right', value: (r) => r.amount },
        ],
        rows,
      },
      totals: [{ label: 'Total received', value: money(amount), hero: true }],
      amountWords: { amount, currency },
      notes: [
        confirmed
          ? { heading: 'Payment confirmed', text: `This receipt confirms that the payment of ${money(amount)} was received by ${companyName}. Please keep it as proof of payment.` }
          : { heading: 'Pending confirmation', text: `This payment is awaiting confirmation by ${companyName}. Please keep this document until you receive the confirmed receipt.` },
      ],
      signatures: [{ label: 'Received by', name: preparedBy }],
      stamp: true,
      footerNote: 'Thank you for your payment.',
    });

    await acquirePdfRenderSlot();
    let page = null;
    try {
      page = await createPage();
      page.setDefaultNavigationTimeout(30_000);
      page.setDefaultTimeout(30_000);
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const pdfBuffer = await withTimeout(
        page.pdf({ format: 'A4', printBackground: true, margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' } }),
        RENDER_TIMEOUT_MS,
        'Receipt PDF render timed out'
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
