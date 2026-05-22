import { createPage, resetBrowser } from './browserService.js';
import TenantInvoice from '../models/TenantInvoice.js';

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

const statusBadge = (status = '') => {
  const colors = {
    paid: '#16a34a',
    partially_paid: '#d97706',
    pending: '#2563eb',
    cancelled: '#6b7280',
    reversed: '#dc2626',
  };
  const labels = {
    paid: 'PAID',
    partially_paid: 'PARTIALLY PAID',
    pending: 'PENDING',
    cancelled: 'CANCELLED',
    reversed: 'REVERSED',
  };
  const color = colors[status] || '#6b7280';
  const label = labels[status] || String(status).toUpperCase();
  return `<span style="display:inline-block;padding:3px 10px;border-radius:4px;background:${color};color:#fff;font-size:11px;font-weight:700;letter-spacing:0.5px;">${label}</span>`;
};

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
    .populate('property', 'propertyName propertyCode address')
    .populate('unit', 'unitNumber name')
    .populate('business', 'companyName name address phone email logo slogan')
    .lean();

  if (!invoice) throw new Error('Invoice not found or access denied');

  const cacheKey = buildInvoicePdfCacheKey(invoice);
  const cachedPdfBuffer = getCachedPdfBuffer(cacheKey);
  if (cachedPdfBuffer) return cachedPdfBuffer;

  if (pdfRenderPromises.has(cacheKey)) {
    return Buffer.from(await pdfRenderPromises.get(cacheKey));
  }

  const renderPromise = (async () => {
    const company = invoice.business || {};
    const companyName = esc(company.companyName || company.name || 'Company');
    const companyAddress = esc(company.address || '');
    const companyPhone = esc(company.phone || '');
    const companyEmail = esc(company.email || '');
    const companyLogo = company.logo || '';

    const tenant = invoice.tenant || {};
    const tenantName = esc(tenant.name || '');
    const tenantCode = esc(tenant.tenantCode || '');
    const tenantEmail = esc(tenant.email || '');

    const property = invoice.property || {};
    const propertyName = esc(property.propertyName || '');
    const propertyCode = esc(property.propertyCode || '');

    const unit = invoice.unit || {};
    const unitNumber = esc(unit.unitNumber || unit.name || '');

    const tax = invoice.taxSnapshot || {};
    const isTaxable = Boolean(tax.isTaxable);
    const taxRate = Number(tax.taxRate || 0);
    const netAmount = Number(tax.netAmount || 0);
    const taxAmount = Number(tax.taxAmount || 0);
    const grossAmount = Number(tax.grossAmount || invoice.amount || 0);
    const displayAmount = isTaxable ? grossAmount : Number(invoice.amount || 0);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Invoice ${esc(invoice.invoiceNumber || '')}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 13px; color: #1e293b; background: #fff; }
  .page { width: 794px; min-height: 1123px; margin: 0 auto; padding: 48px 56px; display: flex; flex-direction: column; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; }
  .company-block { display: flex; flex-direction: column; gap: 2px; }
  .company-name { font-size: 20px; font-weight: 800; color: #0f172a; letter-spacing: -0.3px; }
  .company-detail { font-size: 11px; color: #64748b; }
  .logo { max-height: 60px; max-width: 160px; object-fit: contain; }
  .invoice-title-block { text-align: right; }
  .invoice-label { font-size: 28px; font-weight: 900; color: #0f172a; letter-spacing: -0.5px; text-transform: uppercase; }
  .invoice-number { font-size: 13px; color: #64748b; margin-top: 4px; }
  .divider { height: 2px; background: linear-gradient(90deg, #0ea5e9, #6366f1); border-radius: 1px; margin-bottom: 32px; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 32px; }
  .meta-section { }
  .meta-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #94a3b8; margin-bottom: 10px; }
  .meta-row { display: flex; flex-direction: column; margin-bottom: 6px; }
  .meta-key { font-size: 10px; color: #94a3b8; }
  .meta-value { font-size: 13px; font-weight: 600; color: #0f172a; }
  .table-wrap { margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; }
  thead tr { background: #f1f5f9; }
  th { padding: 10px 12px; text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #64748b; border-bottom: 1px solid #e2e8f0; }
  th.right { text-align: right; }
  td { padding: 12px; font-size: 13px; color: #1e293b; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
  td.right { text-align: right; }
  td.label { font-weight: 600; }
  .totals { width: 280px; margin-left: auto; margin-bottom: 32px; }
  .totals-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; color: #475569; border-bottom: 1px solid #f1f5f9; }
  .totals-row.total { font-size: 15px; font-weight: 800; color: #0f172a; border-bottom: none; padding-top: 10px; }
  .status-row { display: flex; align-items: center; gap: 12px; margin-bottom: 32px; }
  .status-label { font-size: 11px; color: #94a3b8; font-weight: 600; }
  .footer { margin-top: auto; padding-top: 24px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: flex-end; }
  .footer-note { font-size: 10px; color: #94a3b8; }
  .footer-brand { font-size: 10px; color: #cbd5e1; font-weight: 600; }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="company-block">
      ${companyLogo ? `<img src="${esc(companyLogo)}" class="logo" alt="${companyName}" />` : `<div class="company-name">${companyName}</div>`}
      ${companyAddress ? `<div class="company-detail">${companyAddress}</div>` : ''}
      ${companyPhone ? `<div class="company-detail">Tel: ${companyPhone}</div>` : ''}
      ${companyEmail ? `<div class="company-detail">${companyEmail}</div>` : ''}
    </div>
    <div class="invoice-title-block">
      <div class="invoice-label">Invoice</div>
      <div class="invoice-number"># ${esc(invoice.invoiceNumber || '')}</div>
    </div>
  </div>

  <div class="divider"></div>

  <div class="meta-grid">
    <div class="meta-section">
      <div class="meta-title">Billed To</div>
      <div class="meta-row">
        <span class="meta-key">Tenant</span>
        <span class="meta-value">${tenantName}</span>
      </div>
      ${tenantCode ? `<div class="meta-row"><span class="meta-key">Tenant Code</span><span class="meta-value">${tenantCode}</span></div>` : ''}
      ${tenantEmail ? `<div class="meta-row"><span class="meta-key">Email</span><span class="meta-value">${tenantEmail}</span></div>` : ''}
      ${propertyName ? `<div class="meta-row"><span class="meta-key">Property</span><span class="meta-value">${propertyName}${propertyCode ? ` (${propertyCode})` : ''}</span></div>` : ''}
      ${unitNumber ? `<div class="meta-row"><span class="meta-key">Unit</span><span class="meta-value">${unitNumber}</span></div>` : ''}
    </div>
    <div class="meta-section">
      <div class="meta-title">Invoice Details</div>
      <div class="meta-row">
        <span class="meta-key">Invoice Date</span>
        <span class="meta-value">${formatDate(invoice.invoiceDate)}</span>
      </div>
      <div class="meta-row">
        <span class="meta-key">Due Date</span>
        <span class="meta-value">${formatDate(invoice.dueDate)}</span>
      </div>
      <div class="meta-row">
        <span class="meta-key">Category</span>
        <span class="meta-value">${esc(categoryLabel(invoice.category))}</span>
      </div>
    </div>
  </div>

  <div class="status-row">
    <span class="status-label">Status</span>
    ${statusBadge(invoice.status)}
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th class="right">Amount (KES)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="label">${esc(categoryLabel(invoice.category))}${invoice.description ? `<br/><span style="font-weight:400;color:#64748b;font-size:11px;">${esc(invoice.description)}</span>` : ''}</td>
          <td class="right">${formatCurrency(isTaxable ? netAmount : invoice.amount)}</td>
        </tr>
        ${isTaxable && taxAmount > 0 ? `
        <tr>
          <td style="color:#64748b;">Tax (${taxRate}%)</td>
          <td class="right" style="color:#64748b;">${formatCurrency(taxAmount)}</td>
        </tr>` : ''}
      </tbody>
    </table>
  </div>

  <div class="totals">
    ${isTaxable ? `
    <div class="totals-row">
      <span>Subtotal</span>
      <span>KES ${formatCurrency(netAmount)}</span>
    </div>
    <div class="totals-row">
      <span>Tax (${taxRate}%)</span>
      <span>KES ${formatCurrency(taxAmount)}</span>
    </div>` : ''}
    <div class="totals-row total">
      <span>Total Due</span>
      <span>KES ${formatCurrency(displayAmount)}</span>
    </div>
  </div>

  <div class="footer">
    <div class="footer-note">Thank you for your business. Please ensure payment is made by the due date.</div>
    <div class="footer-brand">MILIK PMS</div>
  </div>
</div>
</body>
</html>`;

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
