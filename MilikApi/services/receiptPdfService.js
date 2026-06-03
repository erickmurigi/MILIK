import { createPage, resetBrowser } from './browserService.js';
import RentPayment from '../models/RentPayment.js';

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
  const receipt = await RentPayment.findOne({ _id: receiptId, business: businessId })
    .populate('tenant', 'name email tenantCode phone')
    .populate({ path: 'unit', select: 'unitNumber name property', populate: { path: 'property', select: 'propertyName propertyCode address' } })
    .populate('business', 'companyName name address phone email logo')
    .lean();

  if (!receipt) { const e = new Error('Receipt not found or access denied'); e.status = 404; throw e; }

  // Normalise field names so the rest of the service works unchanged
  receipt.property = receipt.unit?.property || {};
  receipt.receiptDate = receipt.paymentDate || receipt.createdAt;

  const cacheKey = `receipt::${String(receipt._id)}::${receipt.updatedAt ? new Date(receipt.updatedAt).toISOString() : ''}`;
  const cached = getCachedPdfBuffer(cacheKey);
  if (cached) return cached;

  if (pdfRenderPromises.has(cacheKey)) {
    return Buffer.from(await pdfRenderPromises.get(cacheKey));
  }

  const renderPromise = (async () => {
    const company = receipt.business || {};
    const companyName = esc(company.companyName || company.name || 'Company');
    const companyAddress = esc(company.address || '');
    const companyPhone = esc(company.phone || '');
    const companyEmail = esc(company.email || '');
    const companyLogo = company.logo || '';

    const tenant = receipt.tenant || {};
    const tenantName = esc(tenant.name || '');
    const tenantCode = esc(tenant.tenantCode || '');
    const tenantPhone = esc(tenant.phone || '');
    const property = receipt.property || {};
    const propertyName = esc(property.propertyName || '');
    const unit = receipt.unit || {};
    const unitNumber = esc(unit.unitNumber || unit.name || '');

    const amount = Number(receipt.amount || 0);
    const confirmed = receipt.isConfirmed;
    const statusColor = confirmed ? '#16a34a' : '#d97706';
    const statusBgColor = confirmed ? '#dcfce7' : '#fef3c7';
    const statusLabel = confirmed ? 'CONFIRMED' : 'PENDING CONFIRMATION';

    // Build allocation rows from allocationSummary
    const alloc = receipt.allocationSummary || {};
    const allocRows = [
      { label: 'Rent', amount: Number(alloc.rent || 0) },
      { label: 'Utilities', amount: Number(alloc.utility || 0) },
      { label: 'Security Deposit', amount: Number(alloc.deposit || 0) },
      { label: 'Late Penalty', amount: Number(alloc.latePenalty || 0) },
      { label: 'Other Charges', amount: Number(alloc.other || 0) },
      { label: 'Unapplied / Advance', amount: Number(alloc.unapplied || 0) },
    ].filter((r) => r.amount > 0);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Receipt ${esc(receipt.receiptNumber || '')}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;color:#0f172a;background:#fff}
  .page{width:794px;min-height:1123px;margin:0 auto;padding:44px 52px;display:flex;flex-direction:column}
  .hdr{display:grid;grid-template-columns:1fr auto;align-items:flex-start;gap:20px;margin-bottom:20px}
  .logo-img{max-height:56px;max-width:148px;object-fit:contain}
  .logo-fb{font-size:18px;font-weight:900;color:#0B3B2E;letter-spacing:-0.5px}
  .co-detail{font-size:10px;color:#64748b;margin-top:2px;line-height:1.5}
  .doc-title{text-align:right}
  .doc-label{font-size:32px;font-weight:900;color:#0B3B2E;letter-spacing:-0.06em;line-height:1;text-transform:uppercase}
  .doc-number{font-size:13px;font-weight:700;color:#475569;margin-top:5px}
  .accent{height:3px;background:#0B3B2E;border-radius:2px;margin-bottom:24px}
  /* Amount hero */
  .amount-hero{background:#f0faf5;border:1.5px solid #0B3B2E;border-radius:10px;padding:16px 20px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center}
  .hero-left .hero-label{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.12em;color:#0B3B2E}
  .hero-left .hero-amount{font-size:30px;font-weight:900;color:#0B3B2E;letter-spacing:-0.04em;margin-top:2px;font-variant-numeric:tabular-nums}
  .hero-right{text-align:right}
  .status-badge-hero{display:inline-block;padding:5px 14px;border-radius:6px;font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase}
  /* Meta */
  .meta{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:22px}
  .meta-title{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.16em;color:#94a3b8;margin-bottom:10px;padding-bottom:5px;border-bottom:1px solid #f1f5f9}
  .field{margin-bottom:7px}
  .fk{font-size:9px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.08em}
  .fv{font-size:12px;font-weight:600;color:#0f172a;margin-top:1px}
  /* Allocation table */
  .tbl-wrap{margin-bottom:20px}
  table{width:100%;border-collapse:collapse}
  thead tr{background:#0B3B2E;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  th{padding:9px 12px;text-align:left;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:#fff}
  th.r{text-align:right}
  td{padding:10px 12px;font-size:12px;color:#1e293b;border-bottom:1px solid #f1f5f9}
  td.r{text-align:right;font-weight:600;font-variant-numeric:tabular-nums}
  tbody tr:last-child td{border-bottom:none}
  /* Totals */
  .totals{width:260px;margin-left:auto;margin-bottom:24px}
  .t-row{display:flex;justify-content:space-between;padding:5px 0;font-size:12px;color:#475569;border-bottom:1px solid #f8fafc}
  .t-row.grand{border-top:2px solid #0f172a;border-bottom:none;padding-top:10px;margin-top:4px}
  .t-row.grand span{font-size:15px;font-weight:900;color:#0f172a;font-variant-numeric:tabular-nums}
  /* Confirmation box */
  .confirm-box{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 16px;margin-bottom:20px}
  .confirm-title{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.12em;color:#15803d;margin-bottom:4px}
  .confirm-body{font-size:11px;color:#166534;line-height:1.6}
  .pending-box{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin-bottom:20px}
  .pending-title{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.12em;color:#92400e;margin-bottom:4px}
  .pending-body{font-size:11px;color:#78350f;line-height:1.6}
  /* Footer */
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
        ? `<img class="logo-img" src="${esc(companyLogo)}" alt="${companyName}"/>`
        : `<div class="logo-fb">${companyName}</div>`}
      ${companyAddress ? `<div class="co-detail">${companyAddress}</div>` : ''}
      ${companyPhone ? `<div class="co-detail">Tel: ${companyPhone}</div>` : ''}
      ${companyEmail ? `<div class="co-detail">${companyEmail}</div>` : ''}
    </div>
    <div class="doc-title">
      <div class="doc-label">Receipt</div>
      <div class="doc-number"># ${esc(receipt.receiptNumber || receipt.referenceNumber || '—')}</div>
    </div>
  </div>

  <div class="accent"></div>

  <div class="amount-hero">
    <div class="hero-left">
      <div class="hero-label">Amount Received</div>
      <div class="hero-amount">KES ${formatCurrency(amount)}</div>
    </div>
    <div class="hero-right">
      <span class="status-badge-hero" style="background:${statusBgColor};color:${statusColor};">${statusLabel}</span>
    </div>
  </div>

  <div class="meta">
    <div>
      <div class="meta-title">Received From</div>
      <div class="field"><div class="fk">Tenant</div><div class="fv">${tenantName}</div></div>
      ${tenantCode ? `<div class="field"><div class="fk">Tenant Code</div><div class="fv">${tenantCode}</div></div>` : ''}
      ${tenantPhone ? `<div class="field"><div class="fk">Phone</div><div class="fv">${tenantPhone}</div></div>` : ''}
      ${propertyName ? `<div class="field"><div class="fk">Property</div><div class="fv">${propertyName}</div></div>` : ''}
      ${unitNumber ? `<div class="field"><div class="fk">Unit</div><div class="fv">${unitNumber}</div></div>` : ''}
    </div>
    <div>
      <div class="meta-title">Payment Details</div>
      <div class="field"><div class="fk">Date</div><div class="fv">${formatDate(receipt.receiptDate || receipt.paymentDate || receipt.createdAt)}</div></div>
      <div class="field"><div class="fk">Method</div><div class="fv">${esc(humanizeSnake(receipt.paymentMethod || 'Payment'))}</div></div>
      ${receipt.referenceNumber ? `<div class="field"><div class="fk">Transaction Ref</div><div class="fv">${esc(receipt.referenceNumber)}</div></div>` : ''}
      ${receipt.cashbook ? `<div class="field"><div class="fk">Cashbook</div><div class="fv">${esc(receipt.cashbook)}</div></div>` : ''}
    </div>
  </div>

  <div class="tbl-wrap">
    <table>
      <thead>
        <tr>
          <th>Applied To</th>
          <th class="r">Amount (KES)</th>
        </tr>
      </thead>
      <tbody>
        ${allocRows.length > 0
          ? allocRows.map((r) => `<tr><td>${esc(r.label)}</td><td class="r">${formatCurrency(r.amount)}</td></tr>`).join('')
          : `<tr><td>${esc(humanizeSnake(receipt.paymentType || 'Payment'))}${receipt.description ? `<br/><span style="font-size:11px;color:#64748b;font-weight:400">${esc(receipt.description)}</span>` : ''}</td><td class="r">${formatCurrency(amount)}</td></tr>`}
      </tbody>
    </table>
  </div>

  <div class="totals">
    <div class="t-row grand"><span>Total Received</span><span>KES ${formatCurrency(amount)}</span></div>
  </div>

  ${confirmed
    ? `<div class="confirm-box"><div class="confirm-title">Payment Confirmed</div><div class="confirm-body">This receipt confirms that the above payment of <strong>KES ${formatCurrency(amount)}</strong> has been received and applied to the tenant's account by ${companyName}.</div></div>`
    : `<div class="pending-box"><div class="pending-title">Pending Confirmation</div><div class="pending-body">This payment is awaiting confirmation by ${companyName}. Please retain this document until the payment is confirmed.</div></div>`}

  <div class="footer">
    <div class="footer-note">
      Official payment receipt &bull; ${companyName}<br/>
      Powered by Milik Property Management System
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
