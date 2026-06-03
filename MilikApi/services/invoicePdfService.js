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
    .populate('property', 'propertyName propertyCode address invoicePaymentTerms mpesaPaybill')
    .populate('unit', 'unitNumber name')
    .populate('business', 'companyName name address phone email logo slogan invoicePaymentTerms')
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
    const companyName = esc(company.companyName || company.name || 'Company');
    const companyAddress = esc(company.address || '');
    const companyPhone = esc(company.phone || '');
    const companyEmail = esc(company.email || '');
    const companyLogo = company.logo || '';

    const tenant = invoice.tenant || {};
    const tenantName = esc(tenant.name || '');
    const tenantCode = esc(tenant.tenantCode || '');
    const tenantEmail = esc(tenant.email || '');
    const tenantPhone = esc(tenant.phone || '');

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

    const paymentTerms = esc(
      property.invoicePaymentTerms ||
      company.invoicePaymentTerms ||
      'Please pay your invoice before the due date to avoid late penalties.'
    );

    const now = new Date();
    const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : null;
    const isOverdue = dueDate && dueDate < now && !['paid', 'cancelled', 'reversed'].includes(invoice.status);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Invoice ${esc(invoice.invoiceNumber || '')}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;color:#1e293b;background:#fff}
  .page{width:794px;min-height:1123px;margin:0 auto;padding:44px 52px;display:flex;flex-direction:column}
  /* ── Header ── */
  .hdr{display:grid;grid-template-columns:1fr auto;align-items:flex-start;gap:20px;margin-bottom:20px}
  .logo-img{max-height:58px;max-width:150px;object-fit:contain}
  .logo-fb{font-size:18px;font-weight:900;color:#0B3B2E;letter-spacing:-0.5px}
  .co-detail{font-size:10px;color:#64748b;margin-top:2px;line-height:1.5}
  .doc-title{text-align:right}
  .doc-label{font-size:32px;font-weight:900;color:#0B3B2E;letter-spacing:-0.06em;line-height:1;text-transform:uppercase}
  .doc-number{font-size:13px;font-weight:700;color:#475569;margin-top:5px}
  /* ── Accent bar ── */
  .accent{height:3px;background:#0B3B2E;border-radius:2px;margin-bottom:24px}
  /* ── Amount hero ── */
  .amount-hero{background:#f0faf5;border:1.5px solid #0B3B2E;border-radius:10px;padding:14px 20px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:center}
  .hero-left{}
  .hero-label{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.12em;color:#0B3B2E}
  .hero-amount{font-size:28px;font-weight:900;color:#0B3B2E;letter-spacing:-0.04em;font-variant-numeric:tabular-nums;margin-top:2px}
  .hero-right{text-align:right}
  .hero-meta{font-size:10px;color:#64748b;margin-bottom:3px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em}
  .hero-due{font-size:14px;font-weight:800;color:${isOverdue ? '#dc2626' : '#0f172a'}}
  .overdue-badge{display:inline-block;background:#fef2f2;color:#dc2626;border:1px solid #fecaca;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;margin-top:4px}
  /* ── Status ── */
  .status-strip{display:flex;align-items:center;gap:10px;margin-bottom:22px}
  .s-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#94a3b8}
  /* ── Meta grid ── */
  .meta{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:22px}
  .meta-sec{}
  .meta-title{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.16em;color:#94a3b8;margin-bottom:10px;padding-bottom:5px;border-bottom:1px solid #f1f5f9}
  .field{margin-bottom:7px}
  .fk{font-size:9px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.08em}
  .fv{font-size:12px;font-weight:600;color:#0f172a;margin-top:1px}
  /* ── Line items table ── */
  .tbl-wrap{margin-bottom:20px}
  table{width:100%;border-collapse:collapse}
  thead tr{background:#0B3B2E;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  th{padding:9px 12px;text-align:left;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:#fff}
  th.r{text-align:right}
  td{padding:11px 12px;font-size:12px;color:#1e293b;border-bottom:1px solid #f1f5f9;vertical-align:top}
  td.r{text-align:right;font-weight:600;font-variant-numeric:tabular-nums}
  tbody tr:last-child td{border-bottom:none}
  /* ── Totals ── */
  .totals{width:260px;margin-left:auto;margin-bottom:24px}
  .t-row{display:flex;justify-content:space-between;padding:5px 0;font-size:12px;color:#475569;border-bottom:1px solid #f8fafc}
  .t-row.grand{border-top:2px solid #0f172a;border-bottom:none;padding-top:8px;margin-top:4px}
  .t-row.grand span{font-size:14px;font-weight:900;color:#0f172a;font-variant-numeric:tabular-nums}
  /* ── Payment terms ── */
  .terms{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;margin-bottom:20px}
  .terms-title{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.12em;color:#92400e;margin-bottom:4px}
  .terms-body{font-size:11px;color:#78350f;line-height:1.6}
  /* ── Footer ── */
  .footer{margin-top:auto;padding-top:16px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:flex-end}
  .footer-note{font-size:9px;color:#94a3b8;line-height:1.6}
  .footer-brand{font-size:9px;color:#cbd5e1;font-weight:700;letter-spacing:0.06em}
</style>
</head>
<body>
<div class="page">

  <div class="hdr">
    <div>
      ${companyLogo
        ? `<img src="${esc(companyLogo)}" class="logo-img" alt="${companyName}"/>`
        : `<div class="logo-fb">${companyName}</div>`}
      ${companyAddress ? `<div class="co-detail">${companyAddress}</div>` : ''}
      ${companyPhone ? `<div class="co-detail">Tel: ${companyPhone}</div>` : ''}
      ${companyEmail ? `<div class="co-detail">${companyEmail}</div>` : ''}
    </div>
    <div class="doc-title">
      <div class="doc-label">Invoice</div>
      <div class="doc-number"># ${esc(invoice.invoiceNumber || '')}</div>
    </div>
  </div>

  <div class="accent"></div>

  <div class="amount-hero">
    <div class="hero-left">
      <div class="hero-label">Amount Due</div>
      <div class="hero-amount">KES ${formatCurrency(displayAmount)}</div>
    </div>
    <div class="hero-right">
      <div class="hero-meta">Due Date</div>
      <div class="hero-due">${formatDate(invoice.dueDate) || '—'}</div>
      ${isOverdue ? '<div class="overdue-badge">Overdue</div>' : ''}
    </div>
  </div>

  <div class="status-strip">
    <span class="s-label">Status</span>
    ${statusBadge(invoice.status)}
  </div>

  <div class="meta">
    <div class="meta-sec">
      <div class="meta-title">Billed To</div>
      <div class="field"><div class="fk">Name</div><div class="fv">${tenantName}</div></div>
      ${tenantCode ? `<div class="field"><div class="fk">Tenant Code</div><div class="fv">${tenantCode}</div></div>` : ''}
      ${tenantPhone ? `<div class="field"><div class="fk">Phone</div><div class="fv">${tenantPhone}</div></div>` : ''}
      ${tenantEmail ? `<div class="field"><div class="fk">Email</div><div class="fv">${tenantEmail}</div></div>` : ''}
      ${propertyName ? `<div class="field"><div class="fk">Property</div><div class="fv">${propertyName}${propertyCode ? ` (${propertyCode})` : ''}</div></div>` : ''}
      ${unitNumber ? `<div class="field"><div class="fk">Unit</div><div class="fv">${unitNumber}</div></div>` : ''}
    </div>
    <div class="meta-sec">
      <div class="meta-title">Invoice Details</div>
      <div class="field"><div class="fk">Invoice Date</div><div class="fv">${formatDate(invoice.invoiceDate)}</div></div>
      <div class="field"><div class="fk">Due Date</div><div class="fv" style="color:${isOverdue ? '#dc2626' : 'inherit'};font-weight:700">${formatDate(invoice.dueDate) || '—'}</div></div>
      <div class="field"><div class="fk">Category</div><div class="fv">${esc(categoryLabel(invoice.category))}</div></div>
      ${invoice.invoiceNumber ? `<div class="field"><div class="fk">Invoice #</div><div class="fv">${esc(invoice.invoiceNumber)}</div></div>` : ''}
    </div>
  </div>

  <div class="tbl-wrap">
    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th class="r">Amount (KES)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="font-weight:600">${esc(categoryLabel(invoice.category))}${invoice.description
            ? `<br/><span style="font-weight:400;color:#64748b;font-size:11px;line-height:1.6">${esc(invoice.description)}</span>`
            : ''}</td>
          <td class="r">${formatCurrency(isTaxable ? netAmount : displayAmount)}</td>
        </tr>
        ${isTaxable && taxAmount > 0 ? `
        <tr>
          <td style="color:#64748b">VAT / Tax (${taxRate}%)</td>
          <td class="r" style="color:#64748b">${formatCurrency(taxAmount)}</td>
        </tr>` : ''}
      </tbody>
    </table>
  </div>

  <div class="totals">
    ${isTaxable ? `
    <div class="t-row"><span>Subtotal</span><span>KES ${formatCurrency(netAmount)}</span></div>
    <div class="t-row"><span>VAT / Tax (${taxRate}%)</span><span>KES ${formatCurrency(taxAmount)}</span></div>` : ''}
    <div class="t-row grand"><span>Total Due</span><span>KES ${formatCurrency(displayAmount)}</span></div>
  </div>

  <div class="terms">
    <div class="terms-title">Payment Terms</div>
    <div class="terms-body">${paymentTerms}</div>
  </div>

  <div class="footer">
    <div class="footer-note">
      This is a computer-generated invoice and is valid without a signature.<br/>
      ${companyName} &bull; Powered by Milik Property Management System
    </div>
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
